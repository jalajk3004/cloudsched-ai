import { FirstFitScheduler } from '../schedulers/first-fit';
import { BestFitScheduler } from '../schedulers/best-fit';
import { RoundRobinScheduler } from '../schedulers/round-robin';
import { runSimulation } from '../engine/simulation-engine';
import { generateWorkload, WorkloadScenario } from '../workload/generator';
import { loadRealWorkload } from '../workload/real-data-adapter';
import { loadHuaweiWorkload } from '../workload/huawei-data-adapter';
import { computeMetrics, computeOverallScores } from '../metrics/metrics-engine';
import { Task, Scheduler } from '../domain/types';
import { SERVER_CONFIGS } from './server-configs';


async function loadTasksFor(source: string, arg: string, maxTasks: number): Promise<Task[]> {
    if (source === 'synthetic') {
        return generateWorkload({
            scenario: arg as WorkloadScenario, taskCount: maxTasks, seed: 'compare-configs-seed',
            cpuRange: [1, 8], memRange: [512, 8192], durationRange: [2, 20], simulationDuration: 100,
        });
    }
    if (source === 'azure') return loadRealWorkload({ dbPath: arg, maxTasks });
    if (source === 'huawei') return loadHuaweiWorkload({ csvPath: arg, maxTasks });
    throw new Error(`Unknown source "${source}". Use: synthetic <scenario> | azure <path> | huawei <path>`);
}

async function main() {
    const source = process.argv[2];
    const arg = process.argv[3];
    const maxTasks = process.argv[4] ? parseInt(process.argv[4], 10) : 500;

    if (!source || !arg) {
        console.error('Usage: ts-node compare-server-configs.ts <synthetic|azure|huawei> <scenario-or-path> [maxTasks]');
        console.error('Examples:');
        console.error('  ts-node compare-server-configs.ts synthetic cpu-heavy');
        console.error('  ts-node compare-server-configs.ts azure data/azure.sqlite 500');
        console.error('  ts-node compare-server-configs.ts huawei data/huawei-east.csv 500');
        process.exit(1);
    }

    // Load the workload ONCE - every server config below is tested against
    // the exact same tasks, so any difference in results is caused only by
    // the server layout, never by different data.
    const tasks = await loadTasksFor(source, arg, maxTasks);
    console.log(`Loaded ${tasks.length} tasks from source="${source}" (${arg})`);
    console.log(`Testing the SAME ${tasks.length} tasks against ${Object.keys(SERVER_CONFIGS).length} different server layouts:\n`);

    for (const [configName, servers] of Object.entries(SERVER_CONFIGS)) {
        const totalCpu = servers.reduce((a, s) => a + s.cpuCapacity, 0);
        const totalMem = servers.reduce((a, s) => a + s.memCapacity, 0);
        console.log(`=== "${configName}" — ${servers.length} server(s), total capacity: ${totalCpu} CPU / ${totalMem} MB ===`);

        const schedulers: Scheduler[] = [new FirstFitScheduler(), new BestFitScheduler(), new RoundRobinScheduler()];
        const lastArrival = Math.max(0, ...tasks.map(t => t.arrivalTime + t.duration));

        const allMetrics = schedulers.map(scheduler => {
            const result = runSimulation(scheduler, servers, tasks, lastArrival + 1);
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
        console.log('');
    }
}

main().catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
});