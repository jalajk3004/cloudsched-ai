import { generateWorkload, WorkloadScenario } from '../workload/generator';
import { runSimulation } from '../engine/simulation-engine';
import { computeMetrics, objectiveScore, averageMetrics, Metrics } from '../metrics/metrics-engine';
import { DEFAULT_SERVERS, WORKLOAD_PARAMS } from './server-configs';
import { PolicyInterpreterScheduler } from '../ai-scheduler/policy-interpreter';
import { STRATEGY_LIBRARY } from '../ai-scheduler/strategy-library';
import { BestFitScheduler } from '../schedulers/best-fit';
import { FirstFitScheduler } from '../schedulers/first-fit';
import { Scheduler } from '../domain/types';
import { pairedStats, formatPaired } from './stats';

const scenario = (process.argv[2] as WorkloadScenario) || 'mixed';
const repeats = process.argv[3] ? parseInt(process.argv[3], 10) : 30;

const contenders: { name: string; make: () => Scheduler }[] = [
    { name: 'best-fit', make: () => new BestFitScheduler() },
    { name: 'first-fit', make: () => new FirstFitScheduler() },
    ...Object.keys(STRATEGY_LIBRARY).map(name => ({
        name,
        make: (): Scheduler => new PolicyInterpreterScheduler({
            policyName: name, baseStrategy: name, weights: {}, rejectIfNoServerFits: true, tieBreak: 'lowest_server_index',
        }),
    })),
];

const workloads = Array.from({ length: repeats }, (_, r) =>
    generateWorkload({ scenario, seed: `libeval-${scenario}-${r}`, ...WORKLOAD_PARAMS }));

const runs: Record<string, Metrics[]> = {};
for (const c of contenders) {
    runs[c.name] = workloads.map(w => {
        const result = runSimulation(c.make(), DEFAULT_SERVERS, w, WORKLOAD_PARAMS.simulationDuration);
        if (!result.drained) console.warn(`  [warn] ${c.name}: not drained before the hard limit`);
        return computeMetrics(result);
    });
}

const col = (name: string, f: (m: Metrics) => number) => runs[name].map(f);

console.log(`scenario=${scenario} tasks=${WORKLOAD_PARAMS.taskCount} repeats=${repeats}  (diff = strategy - best-fit, paired by seed)\n`);
for (const c of contenders) {
    const m = averageMetrics(runs[c.name]);
    console.log(
        `${c.name.padEnd(22)} done=${(m.completionRate * 100).toFixed(1)}% wait=${m.avgWaitingTime.toFixed(2)} ` +
        `p95=${m.p95WaitingTime.toFixed(1)} maxWait=${m.maxWaitingTime.toFixed(0)} slowdown=${m.avgSlowdown.toFixed(2)} ` +
        `makespan=${m.makespan.toFixed(0)} cpu=${m.cpuUtilizationPct.toFixed(1)}% objective=${objectiveScore(m).toFixed(4)}`,
    );
    if (c.name === 'best-fit') continue;
    console.log(`   wait      ${formatPaired(pairedStats(col(c.name, x => x.avgWaitingTime), col('best-fit', x => x.avgWaitingTime), true))}`);
    console.log(`   p95wait   ${formatPaired(pairedStats(col(c.name, x => x.p95WaitingTime), col('best-fit', x => x.p95WaitingTime), true), 1)}`);
    console.log(`   slowdown  ${formatPaired(pairedStats(col(c.name, x => x.avgSlowdown), col('best-fit', x => x.avgSlowdown), true), 3)}`);
    console.log(`   objective ${formatPaired(pairedStats(col(c.name, objectiveScore), col('best-fit', objectiveScore), false), 4)}`);
}