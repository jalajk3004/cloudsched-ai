import { Scheduler } from '../domain/types';
import { runSimulation, ServerConfig } from '../engine/simulation-engine';
import { generateWorkload, WorkloadConfig } from '../workload/generator';
import { computeMetrics, computeOverallScores, Metrics } from '../metrics/metrics-engine';

export interface ExperimentConfig {
  servers: ServerConfig[];
  workload: WorkloadConfig;
  repeats: number; // R repeated runs per scheduler, each with a derived seed
}

export interface SchedulerFactory {
  name: string;
  create: () => Scheduler; // factory so a FRESH stateful instance (e.g. Round-Robin's pointer) is made per run
}

export interface ExperimentResult {
  perSchedulerRuns: Record<string, Metrics[]>; // raw metrics for every repeat
  perSchedulerAvg: Record<string, Metrics>;    // averaged across repeats
  overallScores: Record<string, number>;       // computed on the averaged metrics
}

export function averageMetrics(list: Metrics[]): Metrics {
  const n = list.length;
  const sum = (f: (m: Metrics) => number) => list.reduce((a, m) => a + f(m), 0) / n;
  return {
    schedulerName: list[0].schedulerName,
    cpuUtilizationPct: sum(m => m.cpuUtilizationPct),
    memUtilizationPct: sum(m => m.memUtilizationPct),
    wastedCpu: sum(m => m.wastedCpu),
    wastedMem: sum(m => m.wastedMem),
    successfullyScheduled: sum(m => m.successfullyScheduled),
    rejected: sum(m => m.rejected),
    avgWaitingTime: sum(m => m.avgWaitingTime),
    avgTurnaroundTime: sum(m => m.avgTurnaroundTime),
  };
}

/**
 * Runs every scheduler in `schedulerFactories` against R repeats of the
 * SAME workload config (only the derived seed changes per repeat, so every
 * scheduler sees the same R task lists). This is the fairness guarantee
 * the whole project depends on.
 */
export function runExperiment(
  config: ExperimentConfig,
  schedulerFactories: SchedulerFactory[],
): ExperimentResult {
  const perSchedulerRuns: Record<string, Metrics[]> = {};

  for (const factory of schedulerFactories) {
    const runs: Metrics[] = [];
    for (let r = 0; r < config.repeats; r++) {
      const seed = `${config.workload.seed}-run${r}`;
      const workload = generateWorkload({ ...config.workload, seed });
      const scheduler = factory.create();
      const result = runSimulation(scheduler, config.servers, workload, config.workload.simulationDuration);
      runs.push(computeMetrics(result));
    }
    perSchedulerRuns[factory.name] = runs;
  }

  const perSchedulerAvg: Record<string, Metrics> = {};
  for (const [name, runs] of Object.entries(perSchedulerRuns)) {
    perSchedulerAvg[name] = averageMetrics(runs);
  }

  const overallScoreMap = computeOverallScores(Object.values(perSchedulerAvg));
  const overallScores: Record<string, number> = {};
  overallScoreMap.forEach((score, name) => (overallScores[name] = score));

  return { perSchedulerRuns, perSchedulerAvg, overallScores };
}
