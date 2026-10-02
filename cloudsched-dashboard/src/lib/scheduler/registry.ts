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

// ── Not-yet-implemented providers ───────────────────────────────────────
// These exist ONLY so the UI has something to render "Not Connected"
// for. Their schedule() is never meant to be called - status stays
// "disconnected" until a teammate merges a real implementation and
// flips it (see the comment above each one).
const geminiScheduler: SchedulerProvider = {
    id: "gemini",
    name: "Gemini",
    type: "ai",
    status: "disconnected",
    async schedule(): Promise<SchedulingResult> {
        // When Developer 2 merges the Gemini branch: replace this function
        // body with a real call, and change status above to "idle". Nothing
        // else in the dashboard needs to change for the card/charts/table
        // to start showing Gemini automatically.
        throw new Error("Gemini scheduler is not connected yet.");
    },
};

const groqScheduler: SchedulerProvider = {
    id: "groq",
    name: "Groq",
    type: "ai",
    status: "disconnected",
    async schedule(): Promise<SchedulingResult> {
        // Same as Gemini above: Developer 3 replaces this body and flips
        // status to "idle" once their branch is merged.
        throw new Error("Groq scheduler is not connected yet.");
    },
};

/** The single source of truth for which schedulers exist. Every part of
 *  the dashboard (cards, charts, table, registry lookups) iterates this
 *  array - nothing hard-codes "qwen" or "gemini" anywhere else. */
export const schedulers: SchedulerProvider[] = [
    baselineScheduler,
    qwenScheduler,
    geminiScheduler,
    groqScheduler,
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