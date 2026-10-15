import { Task } from '../domain/types';
import { ServerConfig } from '../engine/simulation-engine';

export type WorkloadType = 'cpu-heavy' | 'memory-heavy' | 'balanced' | 'bursty';

export interface Dist { min: number; max: number; mean: number; median: number; p90: number }

export interface WorkloadStats {
    taskCount: number;
    cpu: Dist;
    mem: Dist;
    duration: Dist;
    arrivalRate: number;
    burstiness: number;
    priorityPct: { low: number; medium: number; high: number };
    offeredLoad: { cpuPct: number; memPct: number };   // demand ÷ cluster capacity (approx.)
    bottleneck: 'cpu' | 'memory' | 'balanced';
    resourceMix: { cpuHeavy: number; memHeavy: number; balanced: number }; // % of tasks, vs cluster ratio
    type: WorkloadType;
}

function pct(sorted: number[], p: number): number {
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[i];
}

function dist(values: number[]): Dist {
    const s = [...values].sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    return { min: s[0], max: s[s.length - 1], mean, median: pct(s, 0.5), p90: pct(s, 0.9) };
}

export function computeWorkloadStats(tasks: Task[], servers: ServerConfig[]): WorkloadStats {
    if (tasks.length === 0) throw new Error('computeWorkloadStats: empty task list');
    if (servers.length === 0) throw new Error('computeWorkloadStats: empty server list');

    const cpu = dist(tasks.map(t => t.cpuRequired));
    const mem = dist(tasks.map(t => t.memRequired));
    const duration = dist(tasks.map(t => t.duration));

    // Arrival rate + burstiness over every tick in the arrival window (zero-arrival ticks included)
    const arrivals = tasks.map(t => t.arrivalTime);
    const minA = arrivals.reduce((a, b) => Math.min(a, b), Infinity);
    const maxA = arrivals.reduce((a, b) => Math.max(a, b), -Infinity);
    const span = maxA - minA + 1;
    const counts = new Array<number>(span).fill(0);
    for (const a of arrivals) counts[a - minA]++;
    const arrivalRate = tasks.length / span;
    const variance = counts.reduce((acc, c) => acc + (c - arrivalRate) ** 2, 0) / span;
    const burstiness = arrivalRate > 0 ? variance / arrivalRate : 0;

    const n = tasks.length;
    const priorityPct = {
        low: (tasks.filter(t => t.priority === 1).length / n) * 100,
        medium: (tasks.filter(t => t.priority === 2).length / n) * 100,
        high: (tasks.filter(t => t.priority === 3).length / n) * 100,
    };

    // ---- Cluster-relative measures -------------------------------------------------
    const totalCpu = servers.reduce((a, s) => a + s.cpuCapacity, 0);
    const totalMem = servers.reduce((a, s) => a + s.memCapacity, 0);

    // Offered load: resource-ticks demanded ÷ resource-ticks available over the arrival window.
    // Above 100% means demand exceeds capacity, so something must wait or be rejected.
    const cpuDemand = tasks.reduce((a, t) => a + t.cpuRequired * t.duration, 0);
    const memDemand = tasks.reduce((a, t) => a + t.memRequired * t.duration, 0);
    const offeredLoad = {
        cpuPct: (cpuDemand / (totalCpu * span)) * 100,
        memPct: (memDemand / (totalMem * span)) * 100,
    };

    const loadRatio = offeredLoad.cpuPct / (offeredLoad.memPct || 1e-9);
    const bottleneck: WorkloadStats['bottleneck'] =
        loadRatio > 1.5 ? 'cpu' : loadRatio < 1 / 1.5 ? 'memory' : 'balanced';

    // Per-task relationship: does this task use a bigger share of cluster CPU or cluster memory?
    let cpuH = 0, memH = 0, bal = 0;
    for (const t of tasks) {
        const r = (t.cpuRequired / totalCpu) / (t.memRequired / totalMem);
        if (r > 1.5) cpuH++;
        else if (r < 1 / 1.5) memH++;
        else bal++;
    }
    const resourceMix = {
        cpuHeavy: (cpuH / n) * 100,
        memHeavy: (memH / n) * 100,
        balanced: (bal / n) * 100,
    };

    let type: WorkloadType;
    if (burstiness > 2) type = 'bursty';
    else if (bottleneck === 'cpu') type = 'cpu-heavy';
    else if (bottleneck === 'memory') type = 'memory-heavy';
    else type = 'balanced';

    return { taskCount: n, cpu, mem, duration, arrivalRate, burstiness, priorityPct, offeredLoad, bottleneck, resourceMix, type };
}

export function formatWorkloadProfile(s: WorkloadStats): string {
    const full = (d: Dist, digits: number) =>
        `mean=${d.mean.toFixed(digits)} median=${d.median.toFixed(digits)} p90=${d.p90.toFixed(digits)} min=${d.min.toFixed(digits)} max=${d.max.toFixed(digits)}`;
    const three = (d: Dist, digits: number) =>
        `mean=${d.mean.toFixed(digits)} median=${d.median.toFixed(digits)} p90=${d.p90.toFixed(digits)}`;
    return [
        `Workload type: ${s.type}`,
        `Tasks: ${s.taskCount}`,
        `CPU (cores): ${full(s.cpu, 1)}`,
        `Memory (MB): ${full(s.mem, 0)}`,
        `Duration (ticks): ${three(s.duration, 1)}`,
        `Arrival: rate=${s.arrivalRate.toFixed(2)} tasks/tick, burstiness=${s.burstiness.toFixed(2)} (variance/mean per tick; ~1 steady, >2 bursty)`,
        `Priority mix: low ${s.priorityPct.low.toFixed(0)}% / medium ${s.priorityPct.medium.toFixed(0)}% / high ${s.priorityPct.high.toFixed(0)}%`,
        `Offered load vs cluster (approx): CPU ${s.offeredLoad.cpuPct.toFixed(0)}% / memory ${s.offeredLoad.memPct.toFixed(0)}% (above 100% = demand exceeds capacity) -> bottleneck: ${s.bottleneck}`,
        `Resource relationship (per task, vs cluster CPU:memory ratio): CPU-heavy ${s.resourceMix.cpuHeavy.toFixed(0)}% / memory-heavy ${s.resourceMix.memHeavy.toFixed(0)}% / balanced ${s.resourceMix.balanced.toFixed(0)}%`,
    ].join('\n');
}