
import 'dotenv/config';

import { QwenProvider } from '../ai-scheduler/providers/qwen-provider';
import { LLMProvider } from '../ai-scheduler/llm-provider';
import { runSearchLoop } from '../ai-scheduler/search-loop';
import { PolicyInterpreterScheduler } from '../ai-scheduler/policy-interpreter';
import { FirstFitScheduler } from '../schedulers/first-fit';
import { BestFitScheduler } from '../schedulers/best-fit';
import { RoundRobinScheduler } from '../schedulers/round-robin';
import { generateWorkload, WorkloadScenario } from '../workload/generator';
import { runSimulation } from '../engine/simulation-engine';
import { computeMetrics, objectiveScore, Metrics } from '../metrics/metrics-engine';
import { averageMetrics } from './experiment-runner';
import { recordWorkloadRun } from '../persistence/workload-store';
import { Scheduler } from '../domain/types';
import {
    DEFAULT_SERVERS,
    WORKLOAD_PARAMS,
    buildTrainingWorkloads,
    buildValidationWorkloads,
    buildFinalWorkloads,
    saveExperimentConfig,
} from './server-configs';
import { pairedStats, formatPaired } from './stats';

const WORKLOAD_DB_PATH =
    process.env.WORKLOAD_DB_PATH || 'data/workload-history.sqlite';

// Usage:
// npx ts-node src/experiment/run-full-comparision-cli.ts qwen balanced 10
// npx ts-node src/experiment/run-full-comparision-cli.ts balanced 10

const args = process.argv.slice(2);

let scenario: WorkloadScenario = 'mixed';
let repeats = 10;

if (args[0]?.toLowerCase() === 'qwen') {
    scenario = (args[1] as WorkloadScenario) || 'mixed';
    repeats = args[2] ? parseInt(args[2], 10) : 10;
} else if (args[0]) {
    scenario = args[0] as WorkloadScenario;
    repeats = args[1] ? parseInt(args[1], 10) : 10;
}

if (!Number.isInteger(repeats) || repeats < 1) {
    console.error('Repeats must be a positive integer.');
    process.exit(1);
}

const providerName = 'qwen';

async function main(): Promise<void> {
    // ----------------------------------------------------------
    // STEP 1: Search using training workloads and select using
    // validation workloads. Final workloads remain untouched.
    // ----------------------------------------------------------

    const sampleTasks = generateWorkload({
        scenario,
        seed: `${providerName}-search-sample`,
        ...WORKLOAD_PARAMS,
    });

    const provider: LLMProvider = new QwenProvider(
        process.env.OLLAMA_HOST,
        process.env.OLLAMA_MODEL,
    );

    const trainingWorkloads = buildTrainingWorkloads(scenario, 2);
    // Use a larger independent validation set to reduce selection noise.
    const validationWorkloads = buildValidationWorkloads(scenario, 20);

    console.log(
        `Step 1/2: policy search | provider=${providerName} ` +
        `| scenario=${scenario} | tasks=${sampleTasks.length}`,
    );

    console.log(
        `Training workloads: ${1 + trainingWorkloads.length}; ` +
        `validation workloads: ${validationWorkloads.length}`,
    );

    const searchResult = await runSearchLoop(
        provider,
        scenario,
        DEFAULT_SERVERS,
        sampleTasks,
        WORKLOAD_PARAMS.simulationDuration,
        10,
        trainingWorkloads,
        validationWorkloads,
    );

    // If no AI candidate satisfies the validation guardrail, do not silently
    // label an inadmissible policy as the winner. Continue with an explicitly
    // labelled Best-Fit fallback so baseline evaluation still completes.
    const frozenPolicy = searchResult.bestPolicy;
    const usedBestFitFallback = frozenPolicy === null;
    const aiName = usedBestFitFallback
        ? 'ai-qwen-no-eligible-policy-best-fit-fallback'
        : `ai-${providerName}`;

    if (usedBestFitFallback) {
        console.warn(
            '\nNo AI-generated policy passed validation. ' +
            'The AI comparison slot will use Best-Fit as an explicit fallback; ' +
            'this is not an AI win.',
        );
    } else {
        console.log('\n--- Selected policy ---');
        console.log(`Source: ${searchResult.bestSource}`);
        console.log(`Policy: ${frozenPolicy.policyName}`);
        console.log(
            `Validation objective: ${searchResult.bestScore.toFixed(6)}`,
        );
        console.log(
            `Validation Best-Fit objective: ${searchResult.bestFitScore.toFixed(6)}`,
        );
        console.log(
            `Validation score difference: ${(searchResult.bestScore - searchResult.bestFitScore).toFixed(6)}`,
        );
        console.log('Frozen policy:');
        console.log(JSON.stringify(frozenPolicy, null, 2));
    }

    saveExperimentConfig('full-comparison', {
        scenario,
        repeats,
        provider: providerName,
        policy: frozenPolicy,
        usedBestFitFallback,
        trainingWorkloadCount: 1 + trainingWorkloads.length,
        validationWorkloadCount: validationWorkloads.length,
    });

    console.log('\nSelection frozen. No more model calls will occur during final evaluation.');

    // ----------------------------------------------------------
    // STEP 2: Final evaluation on separate held-out workloads.
    // ----------------------------------------------------------

    console.log(
        `\nStep 2/2: First-Fit / Best-Fit / Round-Robin / ` +
        `${usedBestFitFallback ? 'Best-Fit fallback (no eligible AI policy)' : `AI(${providerName})`} on ${repeats} held-out workloads\n`,
    );

    const finalWorkloads = buildFinalWorkloads(scenario, repeats);
    const names = ['first-fit', 'best-fit', 'round-robin', aiName];

    const perSchedulerRuns: Record<string, Metrics[]> = {};
    names.forEach(name => {
        perSchedulerRuns[name] = [];
    });

    for (const [index, workload] of finalWorkloads.entries()) {
        console.log(`Evaluating held-out workload ${index + 1}/${finalWorkloads.length}`);

        // Use fresh instances for each workload because schedulers may be stateful.
        const instances: { name: string; instance: Scheduler }[] = [
            { name: 'first-fit', instance: new FirstFitScheduler() },
            { name: 'best-fit', instance: new BestFitScheduler() },
            { name: 'round-robin', instance: new RoundRobinScheduler() },
            {
                name: aiName,
                instance: frozenPolicy
                    ? new PolicyInterpreterScheduler(frozenPolicy)
                    : new BestFitScheduler(),
            },
        ];

        for (const { name, instance } of instances) {
            const result = runSimulation(
                instance,
                DEFAULT_SERVERS,
                workload,
                WORKLOAD_PARAMS.simulationDuration,
            );

            if (!result.drained) {
                console.warn(
                    `  [warn] ${name}: workload was not drained before the hard limit`,
                );
            }

            const metrics = computeMetrics(result);
            metrics.schedulerName = name;
            perSchedulerRuns[name].push(metrics);
        }
    }

    const perSchedulerAvg: Record<string, Metrics> = {};

    for (const [name, runs] of Object.entries(perSchedulerRuns)) {
        perSchedulerAvg[name] = averageMetrics(runs);
    }

    if (finalWorkloads.length > 0) {
        const runId = await recordWorkloadRun(
            WORKLOAD_DB_PATH,
            'synthetic',
            `${scenario}-full-comparison`,
            finalWorkloads[0],
            {
                scenario,
                repeats,
                provider: providerName,
                workload: WORKLOAD_PARAMS,
            },
        );

        console.log(
            `\nRepresentative workload recorded as run #${runId} ` +
            `in ${WORKLOAD_DB_PATH}`,
        );
    }

    // ----------------------------------------------------------
    // RESULTS
    // ----------------------------------------------------------

    console.log(
        `\n=== Final held-out comparison | Scenario: ${scenario} | ` +
        `Repeats: ${finalWorkloads.length} | ` +
        `Tasks per repeat: ${WORKLOAD_PARAMS.taskCount} ===\n`,
    );

    console.log(
        [
            'Scheduler',
            'Done%',
            'AvgWait',
            'P95Wait',
            'MaxWait',
            'Slowdown',
            'Makespan',
            'CPU%',
            'Mem%',
            'Objective',
        ].map(header => header.padEnd(13)).join(''),
    );

    for (const [name, m] of Object.entries(perSchedulerAvg)) {
        console.log(
            [
                name,
                (m.completionRate * 100).toFixed(1),
                m.avgWaitingTime.toFixed(2),
                m.p95WaitingTime.toFixed(1),
                m.maxWaitingTime.toFixed(0),
                m.avgSlowdown.toFixed(2),
                m.makespan.toFixed(0),
                m.cpuUtilizationPct.toFixed(1),
                m.memUtilizationPct.toFixed(1),
                objectiveScore(m).toFixed(4),
            ].map(value => String(value).padEnd(13)).join(''),
        );
    }

    const ranked = Object.values(perSchedulerAvg)
        .map(m => [m.schedulerName, objectiveScore(m)] as const)
        .sort((a, b) => b[1] - a[1]);

    console.log(
        '\nRanking using objective on averaged metrics (higher is better): ' +
        ranked
            .map(([name, score]) => `${name} (${score.toFixed(4)})`)
            .join(' > '),
    );

    // Paired comparison uses each workload's score, not only averages.
    const aiRuns = perSchedulerRuns[aiName];
    const bestFitRuns = perSchedulerRuns['best-fit'];

    const col = (runs: Metrics[], f: (m: Metrics) => number) =>
        runs.map(f);

    console.log(
        `\n${usedBestFitFallback ? 'Fallback' : 'AI'} vs Best-Fit, paired by held-out workload (first - Best-Fit):`,
    );

    console.log(
        `  AvgWait   ${formatPaired(
            pairedStats(
                col(aiRuns, m => m.avgWaitingTime),
                col(bestFitRuns, m => m.avgWaitingTime),
                true,
            ),
        )}`,
    );

    console.log(
        `  P95Wait   ${formatPaired(
            pairedStats(
                col(aiRuns, m => m.p95WaitingTime),
                col(bestFitRuns, m => m.p95WaitingTime),
                true,
            ),
            1,
        )}`,
    );

    console.log(
        `  Slowdown  ${formatPaired(
            pairedStats(
                col(aiRuns, m => m.avgSlowdown),
                col(bestFitRuns, m => m.avgSlowdown),
                true,
            ),
            3,
        )}`,
    );

    console.log(
        `  Objective ${formatPaired(
            pairedStats(
                col(aiRuns, objectiveScore),
                col(bestFitRuns, objectiveScore),
                false,
            ),
            4,
        )}`,
    );
}

main().catch(err => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Full comparison failed:', message);
    process.exitCode = 1;
});
