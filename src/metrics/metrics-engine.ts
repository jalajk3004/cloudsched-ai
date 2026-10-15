
import { SimulationResult } from '../engine/simulation-engine';

export interface Metrics {
  schedulerName: string;

  // Outcomes: each task must belong to exactly one outcome.
  tasksTotal: number;
  completed: number;
  rejectedInfeasible: number;
  unresolved: number;
  completionRate: number;

  // Latency: completed tasks only; all times are measured in ticks.
  avgWaitingTime: number;
  p95WaitingTime: number;
  maxWaitingTime: number;
  avgTurnaroundTime: number;
  avgSlowdown: number;
  avgWaitP1: number;
  avgWaitP2: number;
  avgWaitP3: number;
  makespan: number;

  // Utilization diagnostics over the arrival window.
  cpuUtilizationPct: number;
  memUtilizationPct: number;
  wastedCpu: number;
  wastedMem: number;

  // Legacy compatibility aliases.
  successfullyScheduled: number;
  rejected: number;
}

export type NumericMetricKey = Exclude<keyof Metrics, 'schedulerName'>;

const avg = (values: number[]): number =>
  values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

/**
 * Nearest-rank percentile:
 * P_p = sortedValues[ceil(p * n) - 1]
 *
 * For p = 0.95, this returns the nearest-rank P95.
 */
const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;

  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError('Percentile must be between 0 and 1.');
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1);

  return sorted[index];
};

const meanWaitingTime = (
  tasks: SimulationResult['tasks'],
): number[] =>
  tasks
    .filter(
      task =>
        task.status === 'completed' &&
        task.startTime !== undefined,
    )
    .map(task => task.startTime! - task.arrivalTime);

/**
 * Computes all metrics from a single simulation run.
 *
 * Mathematical definitions:
 *
 * Feasible tasks:
 *   F = N - I
 *
 * Completion rate:
 *   A = C / F, when F > 0; otherwise 0.
 *
 * Waiting time:
 *   W_i = start_i - arrival_i
 *
 * Turnaround time:
 *   T_i = finish_i - arrival_i
 *
 * Slowdown:
 *   D_i = T_i / duration_i
 *
 * CPU utilization:
 *   U_cpu = 100 * sum_t(CPU_used_t) / sum_t(CPU_capacity_t)
 *
 * Memory utilization:
 *   U_mem = 100 * sum_t(MEM_used_t) / sum_t(MEM_capacity_t)
 *
 * Wasted capacity:
 *   Wasted_CPU = sum_t(CPU_capacity_t - CPU_used_t)
 *   Wasted_MEM = sum_t(MEM_capacity_t - MEM_used_t)
 *
 * Latency metrics use completed tasks only.
 * Utilization and wasted capacity use the arrival window only.
 */
export function computeMetrics(result: SimulationResult): Metrics {
  const { tasks, history, arrivalWindow } = result;

  const completedTasks = tasks.filter(
    task => task.status === 'completed',
  );

  // A rejected task is treated as inherently infeasible.
  // This assumes the simulation engine uses "rejected" exclusively
  // for tasks that cannot fit on any server, even when empty.
  const infeasibleTasks = tasks.filter(
    task => task.status === 'rejected',
  );

  const unresolvedTasks = tasks.filter(
    task => task.status === 'unresolved',
  );

  const tasksTotal = tasks.length;
  const completed = completedTasks.length;
  const rejectedInfeasible = infeasibleTasks.length;
  const unresolved = unresolvedTasks.length;

  const feasibleTasks = tasksTotal - rejectedInfeasible;

  // Completion rate excludes inherently infeasible tasks.
  const completionRate =
    feasibleTasks > 0 ? completed / feasibleTasks : 0;

  // Latency population: completed tasks only.
  const waitingTimes = completedTasks.map(
    task => task.startTime! - task.arrivalTime,
  );

  const turnaroundTimes = completedTasks.map(
    task => task.finishTime! - task.arrivalTime,
  );

  const slowdowns = completedTasks.map(task => {
    if (task.duration <= 0) {
      throw new Error(
        `Task ${task.id} has a non-positive duration.`,
      );
    }

    const turnaround = task.finishTime! - task.arrivalTime;

    return turnaround / task.duration;
  });

  const waitForPriority = (priority: number): number =>
    avg(
      completedTasks
        .filter(task => task.priority === priority)
        .map(task => task.startTime! - task.arrivalTime),
    );

  const makespan =
    completedTasks.length > 0
      ? Math.max(...completedTasks.map(task => task.finishTime!))
      : 0;

  // Use only snapshots in the arrival window.
  const validWindow = Math.max(0, Math.floor(arrivalWindow));

  const windowSnapshots = history.slice(
    0,
    Math.min(validWindow, history.length),
  );

  let totalCpuCapacity = 0;
  let totalMemCapacity = 0;
  let totalCpuUsed = 0;
  let totalMemUsed = 0;
  let wastedCpu = 0;
  let wastedMem = 0;

  for (const snapshot of windowSnapshots) {
    for (const server of snapshot.servers) {
      if (
        server.cpuCapacity < 0 ||
        server.memCapacity < 0 ||
        server.cpuUsed < 0 ||
        server.memUsed < 0 ||
        server.cpuUsed > server.cpuCapacity ||
        server.memUsed > server.memCapacity
      ) {
        throw new Error(
          'Invalid server capacity or resource utilization in simulation history.',
        );
      }

      totalCpuCapacity += server.cpuCapacity;
      totalMemCapacity += server.memCapacity;

      totalCpuUsed += server.cpuUsed;
      totalMemUsed += server.memUsed;

      wastedCpu += server.cpuCapacity - server.cpuUsed;
      wastedMem += server.memCapacity - server.memUsed;
    }
  }

  // Capacity-weighted utilization across all snapshots.
  // Returns 0 when the corresponding total capacity is zero.
  const cpuUtilizationPct =
    totalCpuCapacity > 0
      ? (totalCpuUsed / totalCpuCapacity) * 100
      : 0;

  const memUtilizationPct =
    totalMemCapacity > 0
      ? (totalMemUsed / totalMemCapacity) * 100
      : 0;

  return {
    schedulerName: result.schedulerName,

    tasksTotal,
    completed,
    rejectedInfeasible,
    unresolved,
    completionRate,

    avgWaitingTime: avg(waitingTimes),
    p95WaitingTime: percentile(waitingTimes, 0.95),
    maxWaitingTime:
      waitingTimes.length > 0
        ? Math.max(...waitingTimes)
        : 0,

    avgTurnaroundTime: avg(turnaroundTimes),

    // Convention for an empty completed-task population: 1.
    avgSlowdown:
      slowdowns.length > 0 ? avg(slowdowns) : 1,

    avgWaitP1: waitForPriority(1),
    avgWaitP2: waitForPriority(2),
    avgWaitP3: waitForPriority(3),

    makespan,

    cpuUtilizationPct,
    memUtilizationPct,
    wastedCpu,
    wastedMem,

    // Legacy aliases.
    successfullyScheduled: completed,
    rejected: rejectedInfeasible + unresolved,
  };
}

/**
 * Averages metrics across independent simulation runs.
 *
 * All runs must use the same scheduler name and metric definitions.
 * Each run should use a reproducible workload seed.
 */
export function averageMetrics(list: Metrics[]): Metrics {
  if (list.length === 0) {
    throw new Error(
      'averageMetrics requires at least one simulation result.',
    );
  }

  const schedulerName = list[0].schedulerName;

  if (list.some(m => m.schedulerName !== schedulerName)) {
    throw new Error(
      'averageMetrics cannot average different scheduler names.',
    );
  }

  const numericKeys: NumericMetricKey[] = [
    'tasksTotal',
    'completed',
    'rejectedInfeasible',
    'unresolved',
    'completionRate',
    'avgWaitingTime',
    'p95WaitingTime',
    'maxWaitingTime',
    'avgTurnaroundTime',
    'avgSlowdown',
    'avgWaitP1',
    'avgWaitP2',
    'avgWaitP3',
    'makespan',
    'cpuUtilizationPct',
    'memUtilizationPct',
    'wastedCpu',
    'wastedMem',
    'successfullyScheduled',
    'rejected',
  ];

  const output = {
    schedulerName,
  } as Metrics;

  for (const key of numericKeys) {
    output[key] = avg(list.map(m => m[key]));
  }

  return output;
}

/**
 * THE FIXED OBJECTIVE
 *
 * Used identically for policy search, candidate selection,
 * and final evaluation.
 *
 * J = 0.30*A + 0.25*S_W + 0.15*S_T + 0.15*U_C + 0.15*U_M
 *
 * A   = completion rate
 * S_W = 1 / (1 + average waiting time / 20)
 * S_T = 1 / (1 + average turnaround time / 30)
 * U_C = CPU utilization fraction
 * U_M = memory utilization fraction
 *
 * J is bounded by [0, 1].
 *
 * The objective weights and reference scales are fixed.
 * Do not derive them from the schedulers being compared.
 */
export const OBJECTIVE = {
  weights: {
    completion: 0.30,
    avgWait: 0.25,
    turnaround: 0.15,
    cpuUtilization: 0.15,
    memUtilization: 0.15,
  },

  scales: {
    avgWaitTicks: 20,
    turnaroundTicks: 30,
  },
} as const;

// Legacy export for existing imports.
export const OVERALL_SCORE_WEIGHTS = OBJECTIVE.weights;

export interface ObjectiveBreakdown {
  score: number;

  completionRate: number;
  waitingUtility: number;
  turnaroundUtility: number;
  cpuUtilizationUtility: number;
  memUtilizationUtility: number;

  weightedContributions: {
    completion: number;
    avgWait: number;
    turnaround: number;
    cpuUtilization: number;
    memUtilization: number;
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;

  return Math.max(0, Math.min(1, value));
}

/**
 * Lower-is-better utility:
 *
 * S(x) = 1 / (1 + max(0, x) / reference)
 *
 * x = 0 gives utility 1.
 * As x -> infinity, utility approaches 0 without saturating under heavy load.
 */
function lowerIsBetterUtility(
  value: number,
  reference: number,
): number {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(reference) ||
    reference <= 0
  ) {
    return 0;
  }

  return clamp01(
    1 / (1 + Math.max(0, value) / reference),
  );
}

export function computeObjectiveBreakdown(
  metrics: Metrics,
): ObjectiveBreakdown {
  const w = OBJECTIVE.weights;
  const s = OBJECTIVE.scales;

  const completionRate = clamp01(metrics.completionRate);

  // Do not reward an empty completed-task population
  // with artificially perfect latency.
  const hasCompletedTasks = metrics.completed > 0;

  const waitingUtility = hasCompletedTasks
    ? lowerIsBetterUtility(
      metrics.avgWaitingTime,
      s.avgWaitTicks,
    )
    : 0;

  const turnaroundUtility = hasCompletedTasks
    ? lowerIsBetterUtility(
      metrics.avgTurnaroundTime,
      s.turnaroundTicks,
    )
    : 0;

  const cpuUtilizationUtility = clamp01(
    metrics.cpuUtilizationPct / 100,
  );

  const memUtilizationUtility = clamp01(
    metrics.memUtilizationPct / 100,
  );

  const weightedContributions = {
    completion: w.completion * completionRate,
    avgWait: w.avgWait * waitingUtility,
    turnaround: w.turnaround * turnaroundUtility,
    cpuUtilization: w.cpuUtilization * cpuUtilizationUtility,
    memUtilization: w.memUtilization * memUtilizationUtility,
  };

  const score = Object.values(weightedContributions).reduce(
    (sum, contribution) => sum + contribution,
    0,
  );

  return {
    score: clamp01(score),

    completionRate,
    waitingUtility,
    turnaroundUtility,
    cpuUtilizationUtility,
    memUtilizationUtility,

    weightedContributions,
  };
}

/** Absolute objective J(metrics), bounded to [0, 1]. */
export function computeObjectiveScore(metrics: Metrics): number {
  return computeObjectiveBreakdown(metrics).score;
}

/** Alias for computeObjectiveScore used across experiment runners and evaluation scripts. */
export const objectiveScore = computeObjectiveScore;

/**
 * Compatibility wrapper.
 *
 * Returns ΔJ relative to Best-Fit:
 *
 * ΔJ = J(candidate) - J(Best-Fit)
 *
 * Best-Fit = 0.
 * Positive = better objective score.
 * Negative = worse objective score.
 *
 * This is a difference, not a normalized absolute score.
 */
export function computeOverallScores(
  metricsList: Metrics[],
): Map<string, number> {
  const bestFit = metricsList.find(
    metrics => metrics.schedulerName === 'best-fit',
  );

  if (!bestFit) {
    throw new Error(
      'computeOverallScores requires a metrics entry named "best-fit".',
    );
  }

  const referenceScore = computeObjectiveScore(bestFit);

  return new Map(
    metricsList.map(metrics => [
      metrics.schedulerName,
      computeObjectiveScore(metrics) - referenceScore,
    ]),
  );
}

/** Objective difference against any reference scheduler. */
export function relativeScore(
  metrics: Metrics,
  reference: Metrics,
): number {
  return (
    computeObjectiveScore(metrics) -
    computeObjectiveScore(reference)
  );
}
