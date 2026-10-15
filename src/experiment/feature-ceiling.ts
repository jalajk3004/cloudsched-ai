import seedrandom from 'seedrandom';
import { generateWorkload, WorkloadScenario } from '../workload/generator';
import { runSimulation } from '../engine/simulation-engine';
import { computeMetrics, relativeScore, Metrics } from '../metrics/metrics-engine';
import { averageMetrics } from './experiment-runner';
import { DEFAULT_SERVERS, WORKLOAD_PARAMS } from './server-configs';
import { PolicyInterpreterScheduler } from '../ai-scheduler/policy-interpreter';
import { PolicyProposal, ALLOWED_POLICY_FEATURES } from '../ai-scheduler/llm-provider';
import { BestFitScheduler } from '../schedulers/best-fit';
import { Scheduler } from '../domain/types';

const scenario = (process.argv[2] as WorkloadScenario) || 'mixed';
const candidates = process.argv[3] ? parseInt(process.argv[3], 10) : 300;
const excluded = (process.env.EXCLUDE ?? '').split(',').filter(Boolean);
const features = ALLOWED_POLICY_FEATURES.filter(f => !excluded.includes(f));

const workloads = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, k) => generateWorkload({ scenario, seed: `${prefix}-${scenario}-${k}`, ...WORKLOAD_PARAMS }));

const evalOn = (make: () => Scheduler, ws: ReturnType<typeof workloads>): Metrics =>
    averageMetrics(ws.map(w => computeMetrics(runSimulation(make(), DEFAULT_SERVERS, w, WORKLOAD_PARAMS.simulationDuration))));

const train = workloads('ceil-train', 3);
const test = workloads('ceil-test', 10);
const bfTrain = evalOn(() => new BestFitScheduler(), train);
const bfTest = evalOn(() => new BestFitScheduler(), test);
const rng = seedrandom('ceiling');

function randomPolicy(i: number): PolicyProposal {
    const weights: Record<string, number> = {};
    for (const f of features) if (rng() < 0.6) weights[f] = Math.round((rng() * 2 - 1) * 100) / 100;
    if (Object.keys(weights).length === 0) weights[features[0]] = -1;
    return { policyName: `rand-${i}`, weights: weights as any, rejectIfNoServerFits: true, tieBreak: 'lowest_server_index' } as PolicyProposal;
}

let best: PolicyProposal | null = null;
let bestTrain = -Infinity;
for (let i = 0; i < candidates; i++) {
    const p = randomPolicy(i);
    const s = relativeScore(evalOn(() => new PolicyInterpreterScheduler(p), train), bfTrain);
    if (s > bestTrain) { bestTrain = s; best = p; }
}

const row = (name: string, m: Metrics) =>
    [name, m.cpuUtilizationPct.toFixed(1), m.memUtilizationPct.toFixed(1), m.successfullyScheduled.toFixed(1),
        m.rejected.toFixed(1), m.avgWaitingTime.toFixed(2), m.avgTurnaroundTime.toFixed(2), relativeScore(m, bfTest).toFixed(3)]
        .map(v => String(v).padEnd(14)).join('');

console.log(`\nscenario=${scenario} | ${candidates} random candidates | excluded: ${excluded.join(',') || 'none'} | train=3, test=10 held-out`);
console.log(`Best weights (train score vs best-fit ${bestTrain.toFixed(3)}): ${JSON.stringify(best!.weights)}\n`);
console.log(['Scheduler', 'CPU%', 'Mem%', 'Scheduled', 'Rejected', 'AvgWait', 'AvgTurn', 'vsBestFit'].map(h => h.padEnd(14)).join(''));
console.log(row('best-fit', bfTest));
console.log(row('best random', evalOn(() => new PolicyInterpreterScheduler(best!), test)));