import { FirstFitScheduler } from '../schedulers/first-fit';
import { BestFitScheduler } from '../schedulers/best-fit';
import { RoundRobinScheduler } from '../schedulers/round-robin';
import { runExperiment, ExperimentConfig, SchedulerFactory } from './experiment-runner';

const config: ExperimentConfig = {
  servers: [
    { id: 's1', cpuCapacity: 16, memCapacity: 32768 },
    { id: 's2', cpuCapacity: 16, memCapacity: 32768 },
    { id: 's3', cpuCapacity: 8, memCapacity: 16384 },
    { id: 's4', cpuCapacity: 8, memCapacity: 16384 },
  ],
  workload: {
    scenario: (process.argv[2] as any) || 'mixed',
    taskCount: 200,
    seed: 'demo-seed-1',
    cpuRange: [1, 8],
    memRange: [512, 8192],
    durationRange: [2, 20],
    simulationDuration: 100,
    priorityWeights: [1, 1, 1],
  },
  repeats: 5,
};

const schedulers: SchedulerFactory[] = [
  { name: 'first-fit', create: () => new FirstFitScheduler() },
  { name: 'best-fit', create: () => new BestFitScheduler() },
  { name: 'round-robin', create: () => new RoundRobinScheduler() },
];

const result = runExperiment(config, schedulers);

console.log(`\nScenario: ${config.workload.scenario} | Repeats: ${config.repeats}\n`);
console.log(
  ['Scheduler', 'CPU%', 'Mem%', 'WastedCPU', 'WastedMem', 'Scheduled', 'Rejected', 'AvgWait', 'AvgTurnaround', 'Score']
    .map(h => h.padEnd(12)).join(''),
);
for (const [name, m] of Object.entries(result.perSchedulerAvg)) {
  console.log(
    [
      name,
      m.cpuUtilizationPct.toFixed(1),
      m.memUtilizationPct.toFixed(1),
      m.wastedCpu.toFixed(0),
      m.wastedMem.toFixed(0),
      m.successfullyScheduled.toFixed(1),
      m.rejected.toFixed(1),
      m.avgWaitingTime.toFixed(2),
      m.avgTurnaroundTime.toFixed(2),
      result.overallScores[name].toFixed(3),
    ].map(v => String(v).padEnd(12)).join(''),
  );
}
console.log('');
