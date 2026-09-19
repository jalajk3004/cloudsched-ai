import { FirstFitScheduler } from '../schedulers/first-fit';
import { BestFitScheduler } from '../schedulers/best-fit';
import { RoundRobinScheduler } from '../schedulers/round-robin';
import { loadHuaweiWorkload } from '../workload/huawei-data-adapter';
import { runSimulation, ServerConfig } from '../engine/simulation-engine';
import { computeMetrics, computeOverallScores } from '../metrics/metrics-engine';
import { recordWorkloadRun } from '../persistence/workload-store';

const WORKLOAD_DB_PATH = process.env.WORKLOAD_DB_PATH || 'data/workload-history.sqlite';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: ts-node run-huawei-data-cli.ts <path-to-huawei-csv-file> [maxTasks]');
  console.error('Example: ts-node run-huawei-data-cli.ts ./data/huawei-east-1.csv 500');
  process.exit(1);
}
const maxTasks = process.argv[3] ? parseInt(process.argv[3], 10) : 500;

// Same server config used across the synthetic and Azure experiments,
// so results are comparable in spirit even though the workload source differs.
const servers: ServerConfig[] = [
  { id: 's1', cpuCapacity: 16, memCapacity: 32768 },
  { id: 's2', cpuCapacity: 16, memCapacity: 32768 },
  { id: 's3', cpuCapacity: 8, memCapacity: 16384 },
  { id: 's4', cpuCapacity: 8, memCapacity: 16384 },
];

async function main() {
  const tasks = loadHuaweiWorkload({ csvPath, maxTasks });
  console.log(`Loaded ${tasks.length} real tasks from ${csvPath} (Huawei-East-1 format)\n`);

  if (tasks.length === 0) {
    console.error('No valid tasks were loaded. Check the file path and that it matches the vmid,cpu,memory,time,type schema.');
    process.exit(1);
  }

  const runId = await recordWorkloadRun(WORKLOAD_DB_PATH, 'huawei', csvPath, tasks, { csvPath, maxTasks });
  console.log(`Recorded as workload run #${runId} in ${WORKLOAD_DB_PATH}\n`);

  const lastArrival = Math.max(...tasks.map(t => t.arrivalTime + t.duration));
  const schedulers = [
    { name: 'first-fit', instance: new FirstFitScheduler() },
    { name: 'best-fit', instance: new BestFitScheduler() },
    { name: 'round-robin', instance: new RoundRobinScheduler() },
  ];

  const allMetrics = schedulers.map(({ instance }) => {
    const result = runSimulation(instance, servers, tasks, lastArrival + 1);
    return computeMetrics(result);
  });
  const scores = computeOverallScores(allMetrics);

  console.log(
    ['Scheduler', 'CPU%', 'Mem%', 'WastedCPU', 'WastedMem', 'Scheduled', 'Rejected', 'AvgWait', 'AvgTurnaround', 'Score']
      .map(h => h.padEnd(12)).join(''),
  );
  allMetrics.forEach(m => {
    console.log(
      [
        m.schedulerName, m.cpuUtilizationPct.toFixed(1), m.memUtilizationPct.toFixed(1),
        m.wastedCpu.toFixed(0), m.wastedMem.toFixed(0), m.successfullyScheduled.toFixed(0),
        m.rejected.toFixed(0), m.avgWaitingTime.toFixed(2), m.avgTurnaroundTime.toFixed(2),
        scores.get(m.schedulerName)!.toFixed(3),
      ].map(v => String(v).padEnd(12)).join(''),
    );
  });
}

main().catch(err => {
  console.error('Failed to run:', err.message);
  process.exit(1);
});
