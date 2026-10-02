import { LLMProvider, PolicyProposal, PastAttempt, PolicyPromptContext } from './llm-provider';
import { validatePolicySchema } from './policy-validator';
import { PolicyInterpreterScheduler } from './policy-interpreter';
import { runSimulation, ServerConfig } from '../engine/simulation-engine';
import { computeMetrics, Metrics } from '../metrics/metrics-engine';
import { Task } from '../domain/types';

export interface SearchLogEntry {
  iteration: number;
  providerName: string;
  proposedPolicy: unknown;
  schemaValid: boolean;
  schemaRejectReason?: string;
  dryRunOk?: boolean;
  metrics?: Metrics; // full breakdown (CPU%, mem%, waste, rejections, wait, turnaround) - not just the score
  overallScore?: number;
  accepted: boolean;
}

export interface SearchResult {
  bestPolicy: PolicyProposal | null;
  bestScore: number;
  log: SearchLogEntry[];
}

/** Tiny synthetic sample used ONLY to dry-run a freshly-proposed policy
 *  for crash-safety before it's ever trusted on a real sample workload. */
function buildDryRunFixture(): { servers: ServerConfig[]; tasks: Task[] } {
  const servers: ServerConfig[] = [{ id: 'dry-s1', cpuCapacity: 4, memCapacity: 4096 }];
  const tasks: Task[] = [
    { id: 'dry-t1', cpuRequired: 1, memRequired: 512, duration: 2, arrivalTime: 0, priority: 2, status: 'pending' },
    { id: 'dry-t2', cpuRequired: 2, memRequired: 1024, duration: 3, arrivalTime: 0, priority: 1, status: 'pending' },
  ];
  return { servers, tasks };
}

function dryRun(policy: PolicyProposal): boolean {
  try {
    const { servers, tasks } = buildDryRunFixture();
    const scheduler = new PolicyInterpreterScheduler(policy);
    runSimulation(scheduler, servers, tasks, 10);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the generate -> test -> evaluate -> improve loop for one workload
 * scenario, using whichever LLMProvider is passed in. This function is
 * IDENTICAL no matter which member's provider is used - only the
 * provider argument changes.
 */
export async function runSearchLoop(
  provider: LLMProvider,
  scenario: string,
  sampleServers: ServerConfig[],
  sampleTasks: Task[],
  sampleSimulationDuration: number,
  iterations: number,
): Promise<SearchResult> {
  const log: SearchLogEntry[] = [];
  const pastAttempts: PastAttempt[] = [];
  let bestPolicy: PolicyProposal | null = null;
  let bestScore = -Infinity;

  const serverSummary = `${sampleServers.length} servers: ` + sampleServers.map(s => `${s.cpuCapacity}CPU/${s.memCapacity}MB`).join(', ');
  const taskCpuAvg = sampleTasks.reduce((a, t) => a + t.cpuRequired, 0) / sampleTasks.length;
  const taskMemAvg = sampleTasks.reduce((a, t) => a + t.memRequired, 0) / sampleTasks.length;
  const workloadSummary = `${sampleTasks.length} tasks, avg cpu=${taskCpuAvg.toFixed(1)}, avg mem=${taskMemAvg.toFixed(0)}MB`;

  for (let i = 1; i <= iterations; i++) {
    if (i > 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
    const context: PolicyPromptContext = {
      scenario,
      serverCountSummary: serverSummary,
      sampleWorkloadSummary: workloadSummary,
      allowedFeatures: ['leftoverCpuAfterPlacement', 'leftoverMemAfterPlacement', 'serverCurrentUtilization', 'taskPriority', 'taskWaitTime'],
      pastAttempts,
    };

    let proposed: unknown;
    try {
      proposed = await provider.proposePolicy(context);
    } catch (err) {
      log.push({ iteration: i, providerName: provider.name, proposedPolicy: null, schemaValid: false, schemaRejectReason: `Provider threw: ${(err as Error).message}`, accepted: false });
      continue;
    }

    const schemaResult = validatePolicySchema(proposed);
    if (!schemaResult.valid) {
      log.push({ iteration: i, providerName: provider.name, proposedPolicy: proposed, schemaValid: false, schemaRejectReason: schemaResult.reason, accepted: false });
      continue;
    }

    const policy = proposed as PolicyProposal;
    const dryRunOk = dryRun(policy);
    if (!dryRunOk) {
      log.push({ iteration: i, providerName: provider.name, proposedPolicy: policy, schemaValid: true, dryRunOk: false, accepted: false });
      continue;
    }

    const scheduler = new PolicyInterpreterScheduler(policy);
    const result = runSimulation(scheduler, sampleServers, sampleTasks, sampleSimulationDuration);
    const metrics = computeMetrics(result);
    // simple self-contained score for search purposes: reuse the same
    // shape as the real overall score, computed against itself since
    // during search there's only one candidate at a time
    const overallScore =
      0.25 * (metrics.cpuUtilizationPct / 100) +
      0.25 * (metrics.memUtilizationPct / 100) +
      0.25 * (metrics.successfullyScheduled / (metrics.successfullyScheduled + metrics.rejected || 1)) +
      0.15 * (1 / (1 + metrics.avgWaitingTime)) +
      0.10 * (1 / (1 + metrics.avgTurnaroundTime));

    const accepted = overallScore > bestScore;
    if (accepted) {
      bestScore = overallScore;
      bestPolicy = policy;
    }
    pastAttempts.push({ policy, overallScore });

    log.push({ iteration: i, providerName: provider.name, proposedPolicy: policy, schemaValid: true, dryRunOk: true, metrics, overallScore, accepted });
  }

  return { bestPolicy, bestScore, log };
}
