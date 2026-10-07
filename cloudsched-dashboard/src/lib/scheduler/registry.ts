import { SchedulerProvider, SchedulingResult, Task } from "./types";
import { generateNextMockMetrics } from "../simulation/mock-data";

// ── Temporary placeholder result generator ──────────────────────────────
// This is intentionally a simple stand-in, NOT the real mock-data engine
// (that's Phase 4, lib/simulation/mock-data.ts). Its only job right now is
// to make baseline/qwen's schedule() return something structurally valid
// so the registry is usable and testable today. Phase 4 replaces the body
// of this function - nothing that CALLS schedule() needs to change when
// that happens, because the SchedulerProvider interface stays identical.
function placeholderResult(schedulerId: SchedulerProvider["id"]): SchedulingResult {
    return {
        schedulerId,
        timestamp: Date.now(),
        cpuUtilizationPct: 0,
        memUtilizationPct: 0,
        wastedCpu: 0,
        wastedMem: 0,
        successfullyScheduled: 0,
        rejected: 0,
        avgWaitingTime: 0,
        avgTurnaroundTime: 0,
        throughput: 0,
    };
}

const baselineScheduler: SchedulerProvider = {
    id: "baseline",
    name: "Baseline (First-Fit / Best-Fit / Round-Robin)",
    type: "baseline",
    status: "idle",
    async schedule(_tasks: Task[]): Promise<SchedulingResult> {
        return generateNextMockMetrics("baseline", undefined);
    },
};

const qwenScheduler: SchedulerProvider = {
    id: "qwen",
    name: "Qwen3 (Ollama)",
    type: "ai",
    status: "idle",
    async schedule(_tasks: Task[]): Promise<SchedulingResult> {
        return generateNextMockMetrics("qwen", undefined);
    },
};

/** The single source of truth for which schedulers exist. Every part of
 *  the dashboard (cards, charts, table, registry lookups) iterates this array. */
export const schedulers: SchedulerProvider[] = [
    baselineScheduler,
    qwenScheduler,
];

export function getScheduler(id: SchedulerProvider["id"]): SchedulerProvider | undefined {
    return schedulers.find((s) => s.id === id);
}

/** Only the schedulers actually usable right now - convenient for any
 *  component that should skip disconnected placeholders entirely
 *  (e.g. "run this workload on every available scheduler"). */
export function getConnectedSchedulers(): SchedulerProvider[] {
    return schedulers.filter((s) => s.status !== "disconnected");
}