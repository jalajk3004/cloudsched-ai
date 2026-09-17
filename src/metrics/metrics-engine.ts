import { SimulationResult } from '../engine/simulation-engine';

export interface Metrics {
  schedulerName: string;
  cpuUtilizationPct: number;
  memUtilizationPct: number;
  wastedCpu: number;
  wastedMem: number;
  successfullyScheduled: number;
  rejected: number;
  avgWaitingTime: number;
  avgTurnaroundTime: number;
  // overallScore is computed separately in computeOverallScore() because it
  // needs the full set of schedulers being compared (for normalization).
}

/**
 * Computes every metric from the README's metrics table, using the exact
 * same formulas regardless of which scheduler produced `result`. This
 * function must never branch on `result.schedulerName`.
 */
export function computeMetrics(result: SimulationResult): Metrics {
  const { tasks, history } = result;

  let cpuUtilSum = 0;
  let memUtilSum = 0;
  let wastedCpu = 0;
  let wastedMem = 0;

  for (const snap of history) {
    const totalCpuCap = snap.servers.reduce((s, x) => s + x.cpuCapacity, 0);
    const totalMemCap = snap.servers.reduce((s, x) => s + x.memCapacity, 0);
    const totalCpuUsed = snap.servers.reduce((s, x) => s + x.cpuUsed, 0);
    const totalMemUsed = snap.servers.reduce((s, x) => s + x.memUsed, 0);

    cpuUtilSum += totalCpuCap > 0 ? (totalCpuUsed / totalCpuCap) * 100 : 0;
    memUtilSum += totalMemCap > 0 ? (totalMemUsed / totalMemCap) * 100 : 0;
    wastedCpu += totalCpuCap - totalCpuUsed;
    wastedMem += totalMemCap - totalMemUsed;
  }

  const tickCount = history.length || 1;

  const scheduled = tasks.filter(t => t.status === 'running' || t.status === 'completed');
  const rejected = tasks.filter(t => t.status === 'rejected');
  const completed = tasks.filter(t => t.status === 'completed');

  const waitingTimes = scheduled
    .filter(t => t.startTime !== undefined)
    .map(t => t.startTime! - t.arrivalTime);
  const turnaroundTimes = completed
    .filter(t => t.finishTime !== undefined)
    .map(t => t.finishTime! - t.arrivalTime);

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return {
    schedulerName: result.schedulerName,
    cpuUtilizationPct: cpuUtilSum / tickCount,
    memUtilizationPct: memUtilSum / tickCount,
    wastedCpu,
    wastedMem,
    successfullyScheduled: scheduled.length,
    rejected: rejected.length,
    avgWaitingTime: avg(waitingTimes),
    avgTurnaroundTime: avg(turnaroundTimes),
  };
}

/**
 * Min-max normalizes each metric ACROSS the set of schedulers being
 * compared (so scores are only meaningful within one comparison run), then
 * combines into the overall score. Weights are disclosed here — the
 * dashboard must show this same breakdown, not just the final number.
 */
export const OVERALL_SCORE_WEIGHTS = {
  cpuUtilization: 0.25,
  memUtilization: 0.25,
  acceptanceRate: 0.25, // 1 - rejectionRate
  waitingTime: 0.15,    // inverted: lower is better
  turnaroundTime: 0.10, // inverted: lower is better
} as const;

export function computeOverallScores(metricsList: Metrics[]): Map<string, number> {
  const normalize = (values: number[], invert = false) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    return values.map(v => {
      const n = range === 0 ? 1 : (v - min) / range; // if all equal, treat as fully good
      return invert ? 1 - n : n;
    });
  };

  const totalTasksPerScheduler = metricsList.map(m => m.successfullyScheduled + m.rejected);
  const rejectionRates = metricsList.map((m, i) =>
    totalTasksPerScheduler[i] > 0 ? m.rejected / totalTasksPerScheduler[i] : 0,
  );

  const cpuNorm = normalize(metricsList.map(m => m.cpuUtilizationPct));
  const memNorm = normalize(metricsList.map(m => m.memUtilizationPct));
  const acceptNorm = normalize(rejectionRates, true); // invert: lower rejection = better
  const waitNorm = normalize(metricsList.map(m => m.avgWaitingTime), true);
  const turnNorm = normalize(metricsList.map(m => m.avgTurnaroundTime), true);

  const w = OVERALL_SCORE_WEIGHTS;
  const scores = new Map<string, number>();
  metricsList.forEach((m, i) => {
    const score =
      w.cpuUtilization * cpuNorm[i] +
      w.memUtilization * memNorm[i] +
      w.acceptanceRate * acceptNorm[i] +
      w.waitingTime * waitNorm[i] +
      w.turnaroundTime * turnNorm[i];
    scores.set(m.schedulerName, score);
  });
  return scores;
}
