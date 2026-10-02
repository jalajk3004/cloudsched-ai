import 'dotenv/config';
import { GroqProvider } from '../ai-scheduler/providers/groq-provider';
import { GeminiProvider } from '../ai-scheduler/providers/gemini-provider';
import { QwenProvider } from '../ai-scheduler/providers/qwen-provider';
import { LLMProvider } from '../ai-scheduler/llm-provider';
import { runSearchLoop } from '../ai-scheduler/search-loop';
import { PolicyInterpreterScheduler } from '../ai-scheduler/policy-interpreter';
import { FirstFitScheduler } from '../schedulers/first-fit';
import { BestFitScheduler } from '../schedulers/best-fit';
import { RoundRobinScheduler } from '../schedulers/round-robin';
import { generateWorkload, WorkloadScenario } from '../workload/generator';
import { runSimulation, ServerConfig } from '../engine/simulation-engine';
import { computeMetrics, computeOverallScores, Metrics } from '../metrics/metrics-engine';
import { averageMetrics } from './experiment-runner';
import { recordWorkloadRun } from '../persistence/workload-store';
import { Scheduler } from '../domain/types';

const WORKLOAD_DB_PATH = process.env.WORKLOAD_DB_PATH || 'data/workload-history.sqlite';

const providers: Record<string, () => LLMProvider> = {
    groq: () => new GroqProvider(process.env.GROQ_API_KEY),
    gemini: () => new GeminiProvider(process.env.GEMINI_API_KEY),
    qwen: () => new QwenProvider(process.env.OLLAMA_HOST, process.env.OLLAMA_MODEL),
};

const providerName = process.argv[2];
const scenario = (process.argv[3] as WorkloadScenario) || 'mixed';
const repeats = process.argv[4] ? parseInt(process.argv[4], 10) : 5;

if (!providerName || !providers[providerName]) {
    console.error(`Usage: ts-node run-full-comparison-cli.ts <groq|gemini|qwen> <scenario> [repeats]`);
    console.error(`Available providers: ${Object.keys(providers).join(', ')}`);
    process.exit(1);
}

const servers: ServerConfig[] = [
    { id: 's1', cpuCapacity: 16, memCapacity: 32768 },
    { id: 's2', cpuCapacity: 16, memCapacity: 32768 },
    { id: 's3', cpuCapacity: 8, memCapacity: 16384 },
    { id: 's4', cpuCapacity: 8, memCapacity: 16384 },
];

async function main() {
    const sampleServers: ServerConfig[] = [
        { id: 's1', cpuCapacity: 16, memCapacity: 32768 },
        { id: 's2', cpuCapacity: 8, memCapacity: 16384 },
    ];
    const sampleTasks = generateWorkload({
        scenario, taskCount: 30, seed: `${providerName}-search-sample`,
        cpuRange: [1, 8], memRange: [512, 8192], durationRange: [2, 20], simulationDuration: 50,
    });

    let provider: LLMProvider;
    try {
        provider = providers[providerName]();
    } catch (err) {
        console.error(`\nCould not start the ${providerName} provider:\n  ${(err as Error).message}\n`);
        process.exit(1);
    }

    console.log(`Step 1/2: searching for a policy | provider=${providerName} | scenario=${scenario}`);
    const searchResult = await runSearchLoop(provider, scenario, sampleServers, sampleTasks, 50, 5);

    if (!searchResult.bestPolicy) {
        console.error('\nNo valid AI policy was found during search - cannot run the comparison.');
        console.error('Run the search on its own first to debug: npx ts-node src/experiment/run-ai-search-cli.ts ' + providerName + ' ' + scenario);
        process.exit(1);
    }
    console.log(`Found policy: ${searchResult.bestPolicy.policyName} (search-sample score ${searchResult.bestScore.toFixed(3)})`);
    console.log('This policy is now FROZEN - no more calls to the model from here on.\n');

    console.log(`Step 2/2: running First-Fit / Best-Fit / Round-Robin / AI(${providerName}) on the full workload, ${repeats} repeat(s)\n`);

    const perSchedulerRuns: Record<string, Metrics[]> = {
        'first-fit': [], 'best-fit': [], 'round-robin': [], [`ai-${providerName}`]: [],
    };

    let representativeWorkload: ReturnType<typeof generateWorkload> = [];

    for (let r = 0; r < repeats; r++) {
        const seed = `${scenario}-full-comparison-run${r}`;
        const fullWorkload = generateWorkload({
            scenario, taskCount: 200, seed,
            cpuRange: [1, 8], memRange: [512, 8192], durationRange: [2, 20], simulationDuration: 100,
        });
        if (r === 0) representativeWorkload = fullWorkload;

        const schedulers: { name: string; instance: Scheduler }[] = [
            { name: 'first-fit', instance: new FirstFitScheduler() },
            { name: 'best-fit', instance: new BestFitScheduler() },
            { name: 'round-robin', instance: new RoundRobinScheduler() },
            { name: `ai-${providerName}`, instance: new PolicyInterpreterScheduler(searchResult.bestPolicy!) },
        ];

        for (const { name, instance } of schedulers) {
            const result = runSimulation(instance, servers, fullWorkload, 100);
            const metrics = computeMetrics(result);
            metrics.schedulerName = name;
            perSchedulerRuns[name].push(metrics);
        }
    }

    const perSchedulerAvg: Record<string, Metrics> = {};
    for (const [name, runs] of Object.entries(perSchedulerRuns)) {
        perSchedulerAvg[name] = averageMetrics(runs);
    }
    const scores = computeOverallScores(Object.values(perSchedulerAvg));

    const runId = await recordWorkloadRun(WORKLOAD_DB_PATH, 'synthetic', `${scenario}-full-comparison`, representativeWorkload, { scenario, repeats, provider: providerName });
    console.log(`(Representative workload recorded as run #${runId} in ${WORKLOAD_DB_PATH})\n`);

    console.log(`=== Final comparison: First-Fit vs Best-Fit vs Round-Robin vs AI(${providerName}: ${searchResult.bestPolicy.policyName}) ===`);
    console.log(`Scenario: ${scenario} | Repeats: ${repeats} | Full workload size: 200 tasks per repeat\n`);
    console.log(
        ['Scheduler', 'CPU%', 'Mem%', 'WastedCPU', 'WastedMem', 'Scheduled', 'Rejected', 'AvgWait', 'AvgTurnaround', 'Score']
            .map(h => h.padEnd(14)).join(''),
    );
    for (const [name, m] of Object.entries(perSchedulerAvg)) {
        console.log(
            [
                name, m.cpuUtilizationPct.toFixed(1), m.memUtilizationPct.toFixed(1),
                m.wastedCpu.toFixed(0), m.wastedMem.toFixed(0), m.successfullyScheduled.toFixed(1),
                m.rejected.toFixed(1), m.avgWaitingTime.toFixed(2), m.avgTurnaroundTime.toFixed(2),
                scores.get(name)!.toFixed(3),
            ].map(v => String(v).padEnd(14)).join(''),
        );
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\nRanking (highest overall score first): ${ranked.map(([name, s]) => `${name} (${s.toFixed(3)})`).join(' > ')}`);
}

main().catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
});