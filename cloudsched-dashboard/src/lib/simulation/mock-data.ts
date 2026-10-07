import { SchedulerMetrics, SchedulerId, Task, TaskStatus } from "../scheduler/types";

// ── Mock metrics generation ─────────────────────────────────────────────
// Used only when no real backend/WebSocket is connected (Section 12).
// Every number here is a clearly-labeled placeholder for demo purposes -
// nothing here is a real research result. The dashboard shows a visible
// "DEMO DATA" indicator (wired in the hook, Phase coming next) whenever
// this generator is the data source, so nobody mistakes it for real
// simulation output.

interface MockProfile {
    cpuBase: number;
    cpuVariance: number;
    memBase: number;
    memVariance: number;
    rejectChance: number; // 0-1, per tick
    avgWaitBase: number;
    avgTurnaroundBase: number;
    throughputBase: number;
}

// Mock profiles for baseline and qwen schedulers.
const PROFILES: Record<SchedulerId, MockProfile> = {
    baseline: {
        cpuBase: 68, cpuVariance: 8,
        memBase: 55, memVariance: 6,
        rejectChance: 0.10,
        avgWaitBase: 12, avgTurnaroundBase: 30,
        throughputBase: 14,
    },
    qwen: {
        cpuBase: 74, cpuVariance: 7,
        memBase: 52, memVariance: 6,
        rejectChance: 0.06,
        avgWaitBase: 9, avgTurnaroundBase: 24,
        throughputBase: 16,
    },
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Moves a value slightly from its previous position, instead of jumping
 *  randomly every tick - this is what makes the CPU graph look like a
 *  real, continuously-fluctuating line instead of noise. */
function randomWalk(previous: number, variance: number, min: number, max: number): number {
    const step = (Math.random() - 0.5) * variance;
    return clamp(previous + step, min, max);
}

/**
 * Generates the next mock metrics sample for a scheduler, given its
 * previous sample (or undefined for the very first tick). This is the
 * ONLY function that will need to be swapped out once a real backend
 * exists - everything that calls this depends only on the return shape
 * (SchedulerMetrics), never on how the numbers were produced.
 */
export function generateNextMockMetrics(
    schedulerId: SchedulerId,
    previous: SchedulerMetrics | undefined,
): SchedulerMetrics {
    const profile = PROFILES[schedulerId];
    if (!profile) {
        throw new Error(`No mock profile for scheduler "${schedulerId}" - it should not be generating mock data.`);
    }

    const cpuUtilizationPct = previous
        ? randomWalk(previous.cpuUtilizationPct, profile.cpuVariance, 5, 99)
        : profile.cpuBase;
    const memUtilizationPct = previous
        ? randomWalk(previous.memUtilizationPct, profile.memVariance, 5, 95)
        : profile.memBase;

    const didRejectThisTick = Math.random() < profile.rejectChance;
    const successfullyScheduled = (previous?.successfullyScheduled ?? 0) + (didRejectThisTick ? 0 : 1);
    const rejected = (previous?.rejected ?? 0) + (didRejectThisTick ? 1 : 0);

    return {
        schedulerId,
        timestamp: Date.now(),
        cpuUtilizationPct,
        memUtilizationPct,
        wastedCpu: clamp(randomWalk(previous?.wastedCpu ?? 100, 20, 0, 2000), 0, Number.MAX_SAFE_INTEGER),
        wastedMem: clamp(randomWalk(previous?.wastedMem ?? 50000, 8000, 0, 5_000_000), 0, Number.MAX_SAFE_INTEGER),
        successfullyScheduled,
        rejected,
        avgWaitingTime: Math.max(0, randomWalk(previous?.avgWaitingTime ?? profile.avgWaitBase, 2, 0, 200)),
        avgTurnaroundTime: Math.max(0, randomWalk(previous?.avgTurnaroundTime ?? profile.avgTurnaroundBase, 3, 0, 400)),
        throughput: Math.max(0, randomWalk(previous?.throughput ?? profile.throughputBase, 3, 0, 100)),
    };
}

// ── Mock task generation (Section 8: Live Task Monitor) ─────────────────

let taskCounter = 0;

function randomTaskStatusTransition(current: TaskStatus): TaskStatus {
    if (current === "waiting") return Math.random() < 0.6 ? "running" : "waiting";
    if (current === "running") {
        const roll = Math.random();
        if (roll < 0.5) return "running";
        return roll < 0.9 ? "completed" : "rejected";
    }
    return current; // completed/rejected tasks don't transition further
}

/** Advances an existing task list by one tick: transitions statuses,
 *  ages waiting/turnaround times, and occasionally spawns a new task. */
export function advanceMockTasks(tasks: Task[], connectedSchedulerIds: SchedulerId[]): Task[] {
    const advanced = tasks.map((task) => {
        if (task.status === "completed" || task.status === "rejected") return task;

        const nextStatus = randomTaskStatusTransition(task.status);
        const scheduledBy =
            task.scheduledBy ?? (nextStatus !== "waiting" && connectedSchedulerIds.length > 0
                ? connectedSchedulerIds[Math.floor(Math.random() * connectedSchedulerIds.length)]
                : task.scheduledBy);

        return {
            ...task,
            status: nextStatus,
            scheduledBy,
            waitingTime: task.status === "waiting" ? (task.waitingTime ?? 0) + 1 : task.waitingTime,
            turnaroundTime: (task.turnaroundTime ?? 0) + 1,
        };
    });

    // occasionally spawn a new waiting task
    const withNewTask =
        Math.random() < 0.4
            ? [...advanced, createMockTask()]
            : advanced;

    // keep the list from growing forever - drop the oldest finished tasks first
    const MAX_TASKS = 40;
    if (withNewTask.length <= MAX_TASKS) return withNewTask;
    const finished = withNewTask.filter((t) => t.status === "completed" || t.status === "rejected");
    const active = withNewTask.filter((t) => t.status !== "completed" && t.status !== "rejected");
    const keepFinished = finished.slice(-(MAX_TASKS - active.length));
    return [...active, ...keepFinished];
}

export function createMockTask(): Task {
    taskCounter += 1;
    return {
        id: `T-${100 + taskCounter}`,
        cpuRequired: Math.ceil(Math.random() * 8),
        memRequired: Math.ceil(Math.random() * 16) * 512,
        arrivalTime: Date.now(),
        duration: Math.ceil(Math.random() * 20) + 2,
        priority: (Math.ceil(Math.random() * 3) as 1 | 2 | 3),
        status: "waiting",
        waitingTime: 0,
        turnaroundTime: 0,
    };
}