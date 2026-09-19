import { FirstFitScheduler } from '../schedulers/first-fit';
import { BestFitScheduler } from '../schedulers/best-fit';
import { RoundRobinScheduler } from '../schedulers/round-robin';
import { runSimulation, ServerConfig } from '../engine/simulation-engine';
import { generateWorkload, WorkloadScenario } from '../workload/generator';
import { loadRealWorkload } from '../workload/real-data-adapter';
import { loadHuaweiWorkload } from '../workload/huawei-data-adapter';
import { Task, Scheduler } from '../domain/types';

const servers: ServerConfig[] = [
  { id: 's1', cpuCapacity: 16, memCapacity: 32768 },
  { id: 's2', cpuCapacity: 16, memCapacity: 32768 },
  { id: 's3', cpuCapacity: 8, memCapacity: 16384 },
  { id: 's4', cpuCapacity: 8, memCapacity: 16384 },
];

async function loadTasksFor(source: string, arg: string): Promise<Task[]> {
  if (source === 'synthetic') {
    return generateWorkload({
      scenario: arg as WorkloadScenario, taskCount: 200, seed: 'verify-seed',
      cpuRange: [1, 8], memRange: [512, 8192], durationRange: [2, 20], simulationDuration: 100,
    });
  }
  if (source === 'azure') return loadRealWorkload({ dbPath: arg, maxTasks: 500 });
  if (source === 'huawei') return loadHuaweiWorkload({ csvPath: arg, maxTasks: 500 });
  throw new Error(`Unknown source "${source}". Use: synthetic <scenario> | azure <path> | huawei <path>`);
}

/**
 * Runs a scheduler and checks the two hard correctness invariants every
 * baseline (and later, the AI scheduler) must satisfy no matter what data
 * it's given:
 *   1. No server is ever over-allocated, at any tick.
 *   2. Every task ends up accounted for: scheduled + rejected == total.
 * This is what actually PROVES correctness, rather than just claiming it
 * from looking at the summary numbers.
 */
function verify(scheduler: Scheduler, tasks: Task[]): { name: string; capacityOk: boolean; accountingOk: boolean; maxTick: number } {
  const lastArrival = Math.max(0, ...tasks.map(t => t.arrivalTime + t.duration));
  const result = runSimulation(scheduler, servers, tasks, lastArrival + 1);

  let capacityOk = true;
  for (const snap of result.history) {
    for (const s of snap.servers) {
      if (s.cpuUsed > s.cpuCapacity || s.memUsed > s.memCapacity) {
        capacityOk = false;
      }
    }
  }

  const scheduledCount = result.tasks.filter(t => t.status === 'running' || t.status === 'completed').length;
  const rejectedCount = result.tasks.filter(t => t.status === 'rejected').length;
  const accountingOk = scheduledCount + rejectedCount === tasks.length;

  return { name: scheduler.name, capacityOk, accountingOk, maxTick: result.totalTicks };
}

async function main() {
  const source = process.argv[2];
  const arg = process.argv[3];
  if (!source || !arg) {
    console.error('Usage: ts-node verify-invariants.ts <synthetic|azure|huawei> <scenario-or-path>');
    console.error('Examples:');
    console.error('  ts-node verify-invariants.ts synthetic cpu-heavy');
    console.error('  ts-node verify-invariants.ts azure data/azure.sqlite');
    console.error('  ts-node verify-invariants.ts huawei data/huawei-east.csv');
    process.exit(1);
  }

  const tasks = await loadTasksFor(source, arg);
  console.log(`Loaded ${tasks.length} tasks from source="${source}" (${arg})\n`);

  const schedulers: Scheduler[] = [new FirstFitScheduler(), new BestFitScheduler(), new RoundRobinScheduler()];

  console.log('Checking two hard invariants for each scheduler:');
  console.log('  1) No server is EVER given more work than its real capacity');
  console.log('  2) Every task is accounted for (scheduled + rejected = total tasks)\n');

  let allPassed = true;
  for (const scheduler of schedulers) {
    const { name, capacityOk, accountingOk } = verify(scheduler, tasks);
    const status = capacityOk && accountingOk ? '✅ PASS' : '❌ FAIL';
    if (!capacityOk || !accountingOk) allPassed = false;
    console.log(`${name.padEnd(14)} capacity-never-exceeded=${capacityOk ? 'yes' : 'NO'}   all-tasks-accounted-for=${accountingOk ? 'yes' : 'NO'}   ${status}`);
  }

  console.log(`\nOverall: ${allPassed ? '✅ All schedulers passed both invariants on this data.' : '❌ Something is wrong - investigate before trusting these results.'}`);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
