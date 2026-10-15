import 'dotenv/config';

import { QwenProvider } from '../ai-scheduler/providers/qwen-provider';
import { LLMProvider } from '../ai-scheduler/llm-provider';
import { runSearchLoop } from '../ai-scheduler/search-loop';
import { generateWorkload, WorkloadScenario } from '../workload/generator';
import { ServerConfig } from '../engine/simulation-engine';
import {
  DEFAULT_SERVERS,
  WORKLOAD_PARAMS,
  buildTrainingWorkloads,
} from './server-configs';
import { FEATURE_SET_NAME } from '../ai-scheduler/llm-provider';

console.log(`Feature set: ${FEATURE_SET_NAME}`);

// Usage:
// npx ts-node src/experiment/run-ai-search-cli.ts [scenario]
// npx ts-node src/experiment/run-ai-search-cli.ts qwen [scenario]

const args = process.argv.slice(2);
let scenario: WorkloadScenario = 'mixed';

if (args[0]?.toLowerCase() === 'qwen') {
  scenario = (args[1] as WorkloadScenario) || 'mixed';
} else if (args[0]) {
  scenario = args[0] as WorkloadScenario;
}

const providerName = 'qwen';
const sampleServers: ServerConfig[] = DEFAULT_SERVERS.map(server => ({ ...server }));

const sampleTasks = generateWorkload({
  scenario,
  seed: `${providerName}-search-sample`,
  ...WORKLOAD_PARAMS,
});

async function main(): Promise<void> {
  let provider: LLMProvider;

  try {
    provider = new QwenProvider(
      process.env.OLLAMA_HOST,
      process.env.OLLAMA_MODEL,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nCould not initialize Qwen provider:\n  ${message}\n`);
    console.error(
      'Make sure Ollama is installed and running, and the configured model is available.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Running training-only AI search | provider=${providerName} ` +
    `| scenario=${scenario} | sample size=${sampleTasks.length}\n`,
  );

  const extraWorkloads = buildTrainingWorkloads(scenario, 2);

  const result = await runSearchLoop(
    provider,
    scenario,
    sampleServers,
    sampleTasks,
    WORKLOAD_PARAMS.simulationDuration,
    10,
    extraWorkloads,
  );

  console.log('--- Search log ---');

  for (const entry of result.log) {
    console.log(
      `iter ${entry.iteration} [${entry.source}]: ` +
      `schemaValid=${entry.schemaValid} ` +
      `dryRunOk=${entry.dryRunOk ?? 'n/a'} ` +
      `score=${entry.overallScore?.toFixed(6) ?? 'n/a'} ` +
      `P95-admissible=${entry.admissible ?? 'n/a'} ` +
      `selected-as-current-best=${entry.accepted}` +
      (entry.schemaRejectReason ? ` reason="${entry.schemaRejectReason}"` : ''),
    );

    if (entry.metrics) {
      const m = entry.metrics;
      console.log(
        `        CPU%=${m.cpuUtilizationPct.toFixed(2)} ` +
        `Mem%=${m.memUtilizationPct.toFixed(2)} ` +
        `WastedCPU=${m.wastedCpu.toFixed(0)} ` +
        `WastedMem=${m.wastedMem.toFixed(0)} ` +
        `Scheduled=${m.successfullyScheduled} ` +
        `Rejected=${m.rejected} ` +
        `AvgWait=${m.avgWaitingTime.toFixed(3)} ` +
        `P95Wait=${m.p95WaitingTime.toFixed(3)} ` +
        `AvgTurnaround=${m.avgTurnaroundTime.toFixed(3)}`,
      );
    }

    if (entry.proposedPolicy) {
      const policy = entry.proposedPolicy as {
        policyName?: string;
        weights?: unknown;
        expressions?: unknown;
      };

      console.log(
        `        policy=${policy.policyName ?? 'unnamed'} ` +
        `weights=${JSON.stringify(policy.weights ?? {})}`,
      );

      if (entry.schemaRejectReason === 'duplicate policy structure') {
        console.log('        Duplicate policy was not evaluated.');
      }
    }
  }

  console.log('\n--- Training-search result (not held-out validation) ---');

  if (!result.bestPolicy) {
    console.error('No AI policy was selected by the search loop.');
    console.error('Review the search log and provider errors.');
    process.exitCode = 1;
    return;
  }

  const difference = result.bestScore - result.bestFitScore;

  console.log(`Best training policy: ${result.bestPolicy.policyName}`);
  console.log(`Selected training objective: ${result.bestScore.toFixed(6)}`);
  console.log(`Best-Fit training objective: ${result.bestFitScore.toFixed(6)}`);
  console.log(`Training score difference: ${difference.toFixed(6)}`);
  console.log(
    `Relative difference: ${result.bestFitScore !== 0
      ? ((difference / Math.abs(result.bestFitScore)) * 100).toFixed(3)
      : 'n/a'
    }%`,
  );

  console.log(`Winner source: ${result.bestSource}`);
  console.log('Winning policy:');
  console.log(JSON.stringify(result.bestPolicy, null, 2));

  console.log('\nBaseline training scores:');
  for (const [name, score] of Object.entries(result.baselineScores)) {
    console.log(`  ${name.padEnd(15)} ${score.toFixed(6)}`);
  }

  console.log(
    '\nThese scores use training workloads only. They do not establish ' +
    'generalization or superiority. Use run-full-comparison-cli.ts for ' +
    'validation and separate held-out evaluation.',
  );
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Search loop failed to run:', message);
  process.exitCode = 1;
});
