import { GroqProvider } from '../ai-scheduler/providers/groq-provider';
import { GeminiProvider } from '../ai-scheduler/providers/gemini-provider';
import { HuggingFaceProvider } from '../ai-scheduler/providers/huggingface-provider';
import { LLMProvider } from '../ai-scheduler/llm-provider';
import { runSearchLoop } from '../ai-scheduler/search-loop';
import { generateWorkload } from '../workload/generator';
import { ServerConfig } from '../engine/simulation-engine';

const providerName = process.argv[2];
if (!providerName) {
  console.error('Usage: ts-node run-ai-search-cli.ts <groq|gemini|huggingface> [scenario]');
  process.exit(1);
}

const providers: Record<string, () => LLMProvider> = {
  groq: () => new GroqProvider(process.env.GROQ_API_KEY),
  gemini: () => new GeminiProvider(process.env.GEMINI_API_KEY),
  huggingface: () => new HuggingFaceProvider(process.env.HUGGINGFACE_API_KEY),
};

if (!providers[providerName]) {
  console.error(`Unknown provider "${providerName}". Choose one of: ${Object.keys(providers).join(', ')}`);
  process.exit(1);
}

const scenario = (process.argv[3] as any) || 'mixed';

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
    provider = providers[providerName]();
  } catch (err) {
    console.error(`\nCould not start the ${providerName} provider:\n  ${(err as Error).message}\n`);
    console.error('Check your .env file has the right API key set, then try again.');
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
