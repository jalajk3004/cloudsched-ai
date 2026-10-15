
import {
  LLMProvider,
  PolicyProposal,
  PastAttempt,
  PolicyPromptContext,
  ALLOWED_POLICY_FEATURES,
} from './llm-provider';

import { validatePolicySchema } from './policy-validator';
import { PolicyInterpreterScheduler } from './policy-interpreter';
import { runSimulation, ServerConfig } from '../engine/simulation-engine';
import {
  computeMetrics,
  computeObjectiveScore,
  averageMetrics,
  Metrics,
} from '../metrics/metrics-engine';
import {
  computeWorkloadStats,
  formatWorkloadProfile,
} from '../workload/workload-stats';
import { FirstFitScheduler } from '../schedulers/first-fit';
import { BestFitScheduler } from '../schedulers/best-fit';
import { RoundRobinScheduler } from '../schedulers/round-robin';
import { Task, Scheduler } from '../domain/types';

// ============================================================
// TYPES
// ============================================================

export interface SearchLogEntry {
  iteration: number;
  providerName: string;
  source: 'library' | 'llm';
  proposedPolicy: unknown;
  schemaValid: boolean;
  schemaRejectReason?: string;
  dryRunOk?: boolean;
  metrics?: Metrics;
  overallScore?: number;
  admissible?: boolean;
  selected?: boolean;
  accepted: boolean;
}

export interface SearchResult {
  bestPolicy: PolicyProposal | null;
  bestScore: number;
  bestFitScore: number;
  bestSource: 'library' | 'llm';
  baselineScores: Record<string, number>;
  log: SearchLogEntry[];
}

interface Entry {
  policy: PolicyProposal;
  metrics: Metrics;
  name: string;
  source: 'llm';
  score: number;
  admissible: boolean;
}

export interface WorkloadEvaluation {
  metrics: Metrics;
  score: number;
  admissible: boolean;
  failingWorkloads: number;
  workloadCount: number;
}

// ============================================================
// CONFIGURATION
// ============================================================

export const P95_GUARD_RATIO = 1.5;
export const P95_GUARD_SLACK = 1;

export const p95Limit = (bestFit: Metrics): number =>
  bestFit.p95WaitingTime * P95_GUARD_RATIO + P95_GUARD_SLACK;

export function isAdmissible(m: Metrics, bestFit: Metrics): boolean {
  return m.p95WaitingTime <= p95Limit(bestFit);
}

// ============================================================
// VALIDATION AND DUPLICATE DETECTION
// ============================================================

function dryRun(policy: PolicyProposal): boolean {
  try {
    const servers: ServerConfig[] = [
      {
        id: 'dry-s1',
        cpuCapacity: 4,
        memCapacity: 4096,
      },
    ];

    const tasks: Task[] = [
      {
        id: 'dry-t1',
        cpuRequired: 1,
        memRequired: 512,
        duration: 2,
        arrivalTime: 0,
        priority: 2,
        status: 'pending',
      },
      {
        id: 'dry-t2',
        cpuRequired: 2,
        memRequired: 1024,
        duration: 3,
        arrivalTime: 0,
        priority: 1,
        status: 'pending',
      },
    ];

    runSimulation(
      new PolicyInterpreterScheduler(policy),
      servers,
      tasks,
      10,
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Exact structural duplicate detection.
 * Labels and hypotheses do not change scheduling behavior.
 */
function canonicalPolicy(policy: PolicyProposal): string {
  return JSON.stringify({
    expressions: policy.expressions ?? null,
    weights: policy.weights ?? {},
    rejectIfNoServerFits: policy.rejectIfNoServerFits,
    tieBreak: policy.tieBreak,
  });
}

function isDuplicatePolicy(
  candidate: PolicyProposal,
  previous: PolicyProposal[],
): boolean {
  const candidateKey = canonicalPolicy(candidate);

  return previous.some(
    policy => canonicalPolicy(policy) === candidateKey,
  );
}

// ============================================================
// METRICS AND COMPARISON
// ============================================================

const fmt = (m: Metrics): string =>
  `completed=${(m.completionRate * 100).toFixed(1)}% ` +
  `wait=${m.avgWaitingTime.toFixed(2)} ` +
  `p95wait=${m.p95WaitingTime.toFixed(1)} ` +
  `slowdown=${m.avgSlowdown.toFixed(2)} ` +
  `makespan=${m.makespan.toFixed(0)} ` +
  `cpu=${m.cpuUtilizationPct.toFixed(1)}%`;

function compare(mine: Metrics, ref: Metrics): string {
  const parts: string[] = [];

  const add = (
    name: string,
    a: number,
    b: number,
    lowerBetter: boolean,
    tolerance: number,
  ) => {
    const difference = a - b;

    if (Math.abs(difference) < tolerance) return;

    const better = lowerBetter
      ? difference < 0
      : difference > 0;

    parts.push(
      `${better ? 'WIN' : 'LOSE'} ${name} ` +
      `(${a.toFixed(1)} vs ${b.toFixed(1)})`,
    );
  };

  add('completion%', mine.completionRate * 100,
    ref.completionRate * 100, false, 0.5);
  add('avgWait', mine.avgWaitingTime,
    ref.avgWaitingTime, true, 0.3);
  add('p95Wait', mine.p95WaitingTime,
    ref.p95WaitingTime, true, 1);
  add('slowdown', mine.avgSlowdown,
    ref.avgSlowdown, true, 0.05);

  return parts.length > 0 ? parts.join(', ') : 'tied';
}

/**
 * Select only from admissible candidates. Never silently promote a policy
 * that violates the P95 constraint to a constrained winner.
 */
function pickBest(entries: Entry[]): Entry | null {
  const admissible = entries.filter(entry => entry.admissible);
  if (admissible.length === 0) return null;

  return admissible.reduce((best, current) =>
    current.score > best.score ? current : best,
  );
}

// ============================================================
// MAIN SEARCH LOOP
// ============================================================

export async function runSearchLoop(
  provider: LLMProvider,
  scenario: string,
  sampleServers: ServerConfig[],
  sampleTasks: Task[],
  sampleSimulationDuration: number,
  iterations: number,
  extraWorkloads: Task[][] = [],
  validationWorkloads: Task[][] = [],
): Promise<SearchResult> {
  if (sampleServers.length === 0) {
    throw new Error('Cannot run AI search without servers.');
  }

  if (sampleTasks.length === 0) {
    throw new Error('Cannot run AI search without sample tasks.');
  }

  if (iterations < 1) {
    throw new Error(
      'AI search requires at least one iteration to generate a policy.',
    );
  }

  const trainWorkloads = [sampleTasks, ...extraWorkloads];

  const evalOn = (
    make: () => Scheduler,
    workloads: Task[][],
  ): Metrics => {
    if (workloads.length === 0) {
      throw new Error('Cannot evaluate an empty workload collection.');
    }

    return averageMetrics(
      workloads.map(workload =>
        computeMetrics(
          runSimulation(
            make(),
            sampleServers,
            workload,
            sampleSimulationDuration,
          ),
        ),
      ),
    );
  };

  const evalObjectiveScore = (
    make: () => Scheduler,
    workloads: Task[][],
  ): number => {
    if (workloads.length === 0) {
      throw new Error('Cannot evaluate an empty workload collection.');
    }

    const scores = workloads.map(workload => {
      const result = runSimulation(
        make(),
        sampleServers,
        workload,
        sampleSimulationDuration,
      );

      return computeObjectiveScore(computeMetrics(result));
    });

    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  };

  /**
   * Evaluate each workload independently. P95 admissibility is checked
   * per workload against Best-Fit's P95 on that same workload; averaging
   * P95 values must not hide a bad tail-latency regression.
   */
  const evaluateWorkloads = (
    make: () => Scheduler,
    workloads: Task[][],
    bestFitPerWorkload: Metrics[],
  ): WorkloadEvaluation => {
    if (workloads.length === 0) {
      throw new Error('Cannot evaluate an empty workload collection.');
    }
    if (workloads.length !== bestFitPerWorkload.length) {
      throw new Error('Workload and Best-Fit metric counts do not match.');
    }

    const metricsPerWorkload = workloads.map(workload =>
      computeMetrics(runSimulation(
        make(),
        sampleServers,
        workload,
        sampleSimulationDuration,
      )),
    );
    const score = metricsPerWorkload.reduce(
      (sum, metrics) => sum + computeObjectiveScore(metrics), 0,
    ) / metricsPerWorkload.length;
    const failingWorkloads = metricsPerWorkload.filter(
      (metrics, index) => !isAdmissible(metrics, bestFitPerWorkload[index]),
    ).length;

    return {
      metrics: averageMetrics(metricsPerWorkload),
      score,
      admissible: failingWorkloads === 0,
      failingWorkloads,
      workloadCount: workloads.length,
    };
  };

  const evalTrain = (make: () => Scheduler) =>
    evalOn(make, trainWorkloads);

  const log: SearchLogEntry[] = [];

  // ----------------------------------------------------------
  // Baselines: comparison only, never AI candidates.
  // ----------------------------------------------------------

  const baselines: Metrics[] = [
    {
      name: 'first-fit',
      make: () => new FirstFitScheduler() as Scheduler,
    },
    {
      name: 'best-fit',
      make: () => new BestFitScheduler() as Scheduler,
    },
    {
      name: 'round-robin',
      make: () => new RoundRobinScheduler() as Scheduler,
    },
  ].map(b => ({
    ...evalTrain(b.make),
    schedulerName: b.name,
  }));

  const bestFit = baselines.find(
    baseline => baseline.schedulerName === 'best-fit',
  );

  if (!bestFit) {
    throw new Error('Best-Fit baseline metrics were not calculated.');
  }

  const limit = p95Limit(bestFit);
  const trainBestFitPerWorkload = trainWorkloads.map(workload =>
    computeMetrics(runSimulation(
      new BestFitScheduler(),
      sampleServers,
      workload,
      sampleSimulationDuration,
    )),
  );
  const entries: Entry[] = [];
  const previousPolicies: PolicyProposal[] = [];

  // Keep the last eight schema-valid proposals, including rejected
  // duplicates and dry-run failures. Rejected proposals have null scores.
  const attemptHistory: PastAttempt[] = [];
  const MAX_ATTEMPT_HISTORY = 8;

  const recordAttempt = (policy: PolicyProposal): PastAttempt => {
    const attempt: PastAttempt = {
      policy,
      overallScore: null,
      summary: 'Proposed but not evaluated yet.',
    };

    attemptHistory.push(attempt);

    if (attemptHistory.length > MAX_ATTEMPT_HISTORY) {
      attemptHistory.shift();
    }

    return attempt;
  };

  const addCandidate = (policy: PolicyProposal) => {
    const workloadEvaluation = evaluateWorkloads(
      () => new PolicyInterpreterScheduler(policy),
      trainWorkloads,
      trainBestFitPerWorkload,
    );
    const candidateName = `qwen-candidate-${entries.length + 1}`;
    const entry: Entry = {
      policy,
      metrics: {
        ...workloadEvaluation.metrics,
        schedulerName: candidateName,
      },
      name: candidateName,
      source: 'llm',
      score: workloadEvaluation.score,
      admissible: workloadEvaluation.admissible,
    };

    entries.push(entry);

    return {
      entry,
      isBest: pickBest(entries) === entry,
    };
  };

  // ----------------------------------------------------------
  // Context for the LLM
  // ----------------------------------------------------------

  const serverSummary =
    `${sampleServers.length} servers: ` +
    sampleServers
      .map(server =>
        `${server.cpuCapacity}CPU/${server.memCapacity}MB`,
      )
      .join(', ');

  const allTasks = trainWorkloads.flat();

  const workloadSummary =
    `${trainWorkloads.length} workload(s), ` +
    `${sampleTasks.length} tasks per primary workload, ` +
    `avg cpu=${(
      allTasks.reduce((sum, task) => sum + task.cpuRequired, 0) /
      allTasks.length
    ).toFixed(1)}, ` +
    `avg mem=${(
      allTasks.reduce((sum, task) => sum + task.memRequired, 0) /
      allTasks.length
    ).toFixed(0)}MB`;

  const workloadProfile = formatWorkloadProfile(
    computeWorkloadStats(sampleTasks, sampleServers),
  );

  const baselineSummary = baselines
    .map(
      baseline =>
        `${baseline.schedulerName} ` +
        `(J=${computeObjectiveScore(baseline).toFixed(4)}): ` +
        fmt(baseline),
    )
    .join('\n');

  const strategyMenu = [
    'POLICY GENERATION RULES:',
    'Do not select, copy, or extend a predefined strategy-library policy.',
    'First Fit, Best Fit, and Round Robin are comparison baselines only.',
    'Invent a policy from scratch using the approved expression DSL.',
    'Prefer meaningful feature interactions and conditionals.',
    'Do not return arbitrary executable code.',
    'The simulator enforces resource feasibility.',
  ].join(' ');

  // ----------------------------------------------------------
  // Candidate generation
  // ----------------------------------------------------------

  let note = '';

  for (let iteration = 1; iteration <= iterations; iteration++) {
    const bestEntry = entries.length > 0
      ? pickBest(entries)
      : null;

    const bestPolicySummary = bestEntry
      ? (
        `Best AI candidate: ${bestEntry.policy.policyName}; ` +
        `J=${bestEntry.score.toFixed(4)}; ` +
        `P95 admissible=${bestEntry.admissible}; ` +
        `vs Best-Fit: ${compare(bestEntry.metrics, bestFit)}`
      )
      : 'No AI policy has been evaluated yet. Generate one from scratch.';

    const pastAttempts: PastAttempt[] =
      attemptHistory.slice(-MAX_ATTEMPT_HISTORY);

    const diagnosis = [
      `Scenario: ${scenario}.`,
      `Best-Fit objective=${computeObjectiveScore(bestFit).toFixed(4)}.`,
      `Best-Fit avg wait=${bestFit.avgWaitingTime.toFixed(2)}.`,
      `Best-Fit P95 wait=${bestFit.p95WaitingTime.toFixed(1)}.`,
      `P95 guardrail limit=${limit.toFixed(1)}.`,
      bestPolicySummary,
      'Do not repeat a previous policy structure.',
      'Change the actual expression tree, not only the policy name.',
      'Use the previous attempt outcomes to guide the next proposal.',
      note,
    ].filter(Boolean).join('\n');

    const context: PolicyPromptContext = {
      scenario,
      serverCountSummary: serverSummary,
      sampleWorkloadSummary: workloadSummary,
      workloadProfile,
      allowedFeatures: ALLOWED_POLICY_FEATURES,
      baselineSummary,
      strategyMenu,
      diagnosis,
      pastAttempts,
    };

    let proposed: unknown;

    try {
      proposed = await provider.proposePolicy(context);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error);

      note =
        `Previous generation failed: ${message.slice(0, 240)}. ` +
        'Return one complete valid JSON policy object.';

      log.push({
        iteration,
        providerName: provider.name,
        source: 'llm',
        proposedPolicy: null,
        schemaValid: false,
        schemaRejectReason: `Provider threw: ${message}`,
        accepted: false,
      });

      continue;
    }

    // --------------------------------------------------------
    // Schema validation
    // --------------------------------------------------------

    const check = validatePolicySchema(proposed);

    if (!check.valid) {
      note =
        `Previous proposal was invalid: ${check.reason}. ` +
        'Use only approved features and operators.';

      log.push({
        iteration,
        providerName: provider.name,
        source: 'llm',
        proposedPolicy: proposed,
        schemaValid: false,
        schemaRejectReason: check.reason,
        accepted: false,
      });

      continue;
    }

    const policy = proposed as PolicyProposal;
    const attempt = recordAttempt(policy);

    // --------------------------------------------------------
    // Duplicate detection
    // --------------------------------------------------------

    if (isDuplicatePolicy(policy, previousPolicies)) {
      attempt.summary =
        'REJECTED: duplicate policy structure. ' +
        'Generate a materially different expression tree.';

      note =
        `Duplicate policy rejected: ${canonicalPolicy(policy)}. ` +
        'Do not repeat this formula. Change the actual placement or ordering logic.';

      log.push({
        iteration,
        providerName: provider.name,
        source: 'llm',
        proposedPolicy: policy,
        schemaValid: true,
        schemaRejectReason: 'duplicate policy structure',
        accepted: false,
      });

      continue;
    }

    previousPolicies.push(policy);

    // --------------------------------------------------------
    // Dry run
    // --------------------------------------------------------

    if (!dryRun(policy)) {
      attempt.summary =
        'REJECTED: dry run failed. ' +
        'Schema passed, but the policy could not execute in the simulator.';

      note =
        'Previous policy failed the dry run. Correct the expression structure.';

      log.push({
        iteration,
        providerName: provider.name,
        source: 'llm',
        proposedPolicy: policy,
        schemaValid: true,
        dryRunOk: false,
        schemaRejectReason: 'dry run failed',
        accepted: false,
      });

      continue;
    }

    // --------------------------------------------------------
    // Evaluate candidate
    // --------------------------------------------------------

    try {
      const { entry, isBest } = addCandidate(policy);

      attempt.overallScore = entry.score;
      attempt.summary =
        `EVALUATED; ${fmt(entry.metrics)}; ` +
        `P95 admissible on every training workload=${entry.admissible}; ` +
        `selected as current best=${isBest}.`;

      note = entry.admissible
        ? (
          `Previous policy score J=${entry.score.toFixed(4)}. ` +
          `${fmt(entry.metrics)}. ` +
          'Try to improve the objective while respecting the P95 guardrail.'
        )
        : (
          `Previous policy violated P95 guardrail: ` +
          `${entry.metrics.p95WaitingTime.toFixed(1)} > ${limit.toFixed(1)}. ` +
          'Reduce excessive waiting without sacrificing the objective.'
        );

      log.push({
        iteration,
        providerName: provider.name,
        source: 'llm',
        proposedPolicy: policy,
        schemaValid: true,
        dryRunOk: true,
        metrics: entry.metrics,
        overallScore: entry.score,
        admissible: entry.admissible,
        accepted: isBest,
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error);

      attempt.summary =
        `EVALUATION FAILED: ${message.slice(0, 200)}`;

      note =
        `Policy passed dry-run but evaluation failed: ` +
        `${message.slice(0, 200)}.`;

      log.push({
        iteration,
        providerName: provider.name,
        source: 'llm',
        proposedPolicy: policy,
        schemaValid: true,
        dryRunOk: true,
        schemaRejectReason: `Evaluation failed: ${message}`,
        accepted: false,
      });
    }
  }

  // ----------------------------------------------------------
  // Baseline scores
  // ----------------------------------------------------------

  const baselineScores: Record<string, number> = {};

  baselines.forEach(baseline => {
    baselineScores[baseline.schedulerName] =
      computeObjectiveScore(baseline);
  });

  if (entries.length === 0) {
    return {
      bestPolicy: null,
      bestScore: Number.NEGATIVE_INFINITY,
      bestFitScore: computeObjectiveScore(bestFit),
      bestSource: 'llm',
      baselineScores,
      log,
    };
  }

  let best = pickBest(entries);
  let bestScore = best?.score ?? Number.NEGATIVE_INFINITY;

  // By default this is the training Best-Fit score.
  let bestFitScore = computeObjectiveScore(bestFit);

  // ----------------------------------------------------------
  // Optional held-out validation
  // ----------------------------------------------------------

  let validationAdmissible = true;

  if (validationWorkloads.length > 0) {
    const valBestFitPerWorkload = validationWorkloads.map(workload =>
      computeMetrics(runSimulation(
        new BestFitScheduler(),
        sampleServers,
        workload,
        sampleSimulationDuration,
      )),
    );
    bestFitScore = evalObjectiveScore(
      () => new BestFitScheduler(),
      validationWorkloads,
    );

    // Evaluate every unique candidate on validation. Do not pre-filter using
    // training scores; that can discard policies that generalize better.
    const scored = entries.map(entry => {
      const evaluation = evaluateWorkloads(
        () => new PolicyInterpreterScheduler(entry.policy),
        validationWorkloads,
        valBestFitPerWorkload,
      );
      return { entry, ...evaluation };
    });

    const admissibleCandidates = scored.filter(candidate => candidate.admissible);
    if (admissibleCandidates.length === 0) {
      validationAdmissible = false;
      bestScore = Number.NEGATIVE_INFINITY;
      console.log(
        `[validation] No AI policy passed the P95 guardrail on all ` +
        `${validationWorkloads.length} validation workloads. Best-Fit must be used as fallback.`,
      );
    } else {
      const winner = admissibleCandidates.reduce((currentBest, candidate) =>
        candidate.score > currentBest.score ? candidate : currentBest,
      );
      best = winner.entry;
      bestScore = winner.score;
      console.log(
        `[validation] selected=${best.policy.policyName}; score=${bestScore.toFixed(4)}; ` +
        `P95-admissible on ${winner.workloadCount}/${winner.workloadCount} workloads; ` +
        `validationBestFit=${bestFitScore.toFixed(4)}; ` +
        `avgP95=${winner.metrics.p95WaitingTime.toFixed(2)}`,
      );
    }
  } else {
    const trainingWinner = pickBest(entries);
    if (!trainingWinner) {
      console.log(
        '[training] No AI policy passed the P95 guardrail on every training workload. ' +
        'No eligible AI policy selected.',
      );
      return {
        bestPolicy: null,
        bestScore: Number.NEGATIVE_INFINITY,
        bestFitScore: computeObjectiveScore(bestFit),
        bestSource: 'llm',
        baselineScores,
        log,
      };
    }
    best = trainingWinner;
    bestScore = trainingWinner.score;
  }

  // Mark selection explicitly in the search log. `accepted` means it became
  // the best eligible candidate at that point; `selected` means final winner.
  for (const row of log) {
    if (row.proposedPolicy && typeof row.proposedPolicy === 'object') {
      row.selected =
        validationAdmissible &&
        JSON.stringify(row.proposedPolicy) === JSON.stringify(best?.policy);
    }
  }

  if (!validationAdmissible) {
    return {
      bestPolicy: null,
      bestScore: Number.NEGATIVE_INFINITY,
      bestFitScore,
      bestSource: 'llm',
      baselineScores,
      log,
    };
  }

  return {
    bestPolicy: best?.policy ?? null,
    bestScore,
    bestFitScore,
    bestSource: 'llm',
    baselineScores,
    log,
  };
}
