import 'dotenv/config';
import { QwenProvider } from '../ai-scheduler/providers/qwen-provider';
import { LLMProvider } from '../ai-scheduler/llm-provider';
import { runSearchLoop } from '../ai-scheduler/search-loop';
import { generateWorkload, WorkloadScenario } from '../workload/generator';
import { ServerConfig } from '../engine/simulation-engine';

// Supports: ts-node run-ai-search-cli.ts [scenario] or ts-node run-ai-search-cli.ts qwen [scenario]
const args = process.argv.slice(2);
let scenario: WorkloadScenario = 'mixed';
if (args[0] && args[0].toLowerCase() === 'qwen') {
  scenario = (args[1] as WorkloadScenario) || 'mixed';
} else if (args[0]) {
  scenario = args[0] as WorkloadScenario;
}

const providerName = 'qwen';

const sampleServers: ServerConfig[] = [
  { id: 's1', cpuCapacity: 16, memCapacity: 32768 },
  { id: 's2', cpuCapacity: 8, memCapacity: 16384 },
];

// Deliberately SMALL sample (per the professor's suggestion) so the
// search loop stays fast and cheap - this is Step 1 from the methodology
// document, never the full workload used for the final comparison.
const sampleTasks = generateWorkload({
  scenario,
  taskCount: 30,
  seed: `${providerName}-search-sample`,
  cpuRange: [1, 8],
  memRange: [512, 8192],
  durationRange: [2, 20],
  simulationDuration: 50,
});

async function main() {
  let provider: LLMProvider;
  try {
    provider = new QwenProvider(process.env.OLLAMA_HOST, process.env.OLLAMA_MODEL);
  } catch (err) {
    console.error(`\nCould not start the Qwen provider:\n  ${(err as Error).message}\n`);
    console.error('Make sure Ollama is installed and running (e.g. ollama run qwen3:4b).');
    process.exit(1);
  }

  console.log(`Running AI search loop | provider=${providerName} | scenario=${scenario} | sample size=${sampleTasks.length}\n`);

  const result = await runSearchLoop(provider, scenario, sampleServers, sampleTasks, 50, 5);

  console.log('--- Search log ---');
  for (const entry of result.log) {
    console.log(
      `iter ${entry.iteration}: schemaValid=${entry.schemaValid} dryRunOk=${entry.dryRunOk ?? 'n/a'} ` +
      `score=${entry.overallScore?.toFixed(3) ?? 'n/a'} accepted=${entry.accepted}` +
      (entry.schemaRejectReason ? ` reason="${entry.schemaRejectReason}"` : ''),
    );
    if (entry.metrics) {
      const m = entry.metrics;
      console.log(
        `        CPU%=${m.cpuUtilizationPct.toFixed(1)} Mem%=${m.memUtilizationPct.toFixed(1)} ` +
        `WastedCPU=${m.wastedCpu.toFixed(0)} WastedMem=${m.wastedMem.toFixed(0)} ` +
        `Scheduled=${m.successfullyScheduled} Rejected=${m.rejected} ` +
        `AvgWait=${m.avgWaitingTime.toFixed(2)} AvgTurnaround=${m.avgTurnaroundTime.toFixed(2)}`,
      );
    }
  }

  console.log('\n--- Result ---');
  if (result.bestPolicy) {
    console.log(`Best policy found: ${result.bestPolicy.policyName} (score ${result.bestScore.toFixed(3)})`);
    console.log(JSON.stringify(result.bestPolicy, null, 2));
  } else {
    console.log('No valid policy was found. This is expected right now: the provider is still a stub.');
    console.log('Once the provider is implemented, this will print the best policy it found.');
  }
}

main().catch(err => {
  console.error('Search loop failed to run:', err.message);
  process.exit(1);
});