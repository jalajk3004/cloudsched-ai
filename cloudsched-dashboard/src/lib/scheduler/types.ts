// ── The shared data contract ────────────────────────────────────────────
// Every component in this dashboard depends ONLY on the shapes defined
// here - never on "how Qwen works" or "how Gemini works" specifically.
// This is what lets Gemini and Groq be added later by just registering
// a new provider, with zero changes to any chart, table, or card.

/** The four schedulers this dashboard knows about. Adding a fifth later
 *  means adding one entry here - nothing else in this file changes. */
export type SchedulerId = "baseline" | "qwen" | "gemini" | "groq";

/** "baseline" = a classical heuristic (First-Fit/Best-Fit/Round-Robin
 *  results, combined or selected). "ai" = an LLM-driven scheduler. */
export type SchedulerKind = "baseline" | "ai";

/**
 * - "disconnected": not implemented/merged yet (Gemini, Groq today) - the
 *   card shows "Not Connected" and every chart simply omits this scheduler.
 * - "idle": implemented and reachable, but no simulation is running.
 * - "running": actively scheduling tasks in the current simulation.
 * - "stopped": a simulation ran and was stopped/finished.
 */
export type SchedulerStatus = "disconnected" | "idle" | "running" | "stopped";

// ── Tasks (Section 8: Live Task Monitor) ────────────────────────────────

export type TaskStatus = "waiting" | "running" | "completed" | "rejected";

export interface Task {
    id: string;
    cpuRequired: number;
    memRequired: number;
    arrivalTime: number;
    duration: number;
    priority: 1 | 2 | 3;

    // Set once a scheduler has acted on this task - undefined until then.
    status: TaskStatus;
    scheduledBy?: SchedulerId;
    waitingTime?: number;
    turnaroundTime?: number;
}

// ── The normalized metrics contract (Section 23) ────────────────────────
// This is THE contract between any backend/simulator and this dashboard.
// Every scheduler - baseline, Qwen, Gemini, Groq, or anything added after
// - must produce exactly this shape. Charts, tables, and cards read only
// from this interface.

export interface SchedulerMetrics {
    schedulerId: SchedulerId;
    timestamp: number; // epoch ms - the x-axis value for every time-series chart

    cpuUtilizationPct: number; // 0-100
    memUtilizationPct: number; // 0-100

    wastedCpu: number;
    wastedMem: number;

    successfullyScheduled: number;
    rejected: number;

    avgWaitingTime: number;
    avgTurnaroundTime: number;

    throughput: number; // tasks processed per second, at this timestamp
}

/**
 * Section 10 of the spec names this "SchedulingResult" (the return type
 * of a scheduler's schedule() call) with slightly different field names
 * than Section 23's "SchedulerMetrics" (the dashboard's data contract).
 * Rather than maintain two divergent shapes that mean the same thing,
 * this dashboard treats them as the same contract: whatever a scheduler
 * returns from schedule() IS a SchedulerMetrics record. One shape, one
 * source of truth, no field-name mismatches to keep in sync by hand.
 */
export type SchedulingResult = SchedulerMetrics;

// ── The scheduler provider interface (Section 10 + 22) ──────────────────
// The dashboard only ever talks to schedulers through this interface.
// A provider for a model that isn't ready yet (Gemini, Groq right now)
// simply reports status: "disconnected" and its schedule() is never
// called - see the registry in Phase 3 for exactly how that works.

export interface SchedulerProvider {
    id: SchedulerId;
    name: string; // display name, e.g. "Qwen3 (Ollama)"
    type: SchedulerKind;

    status: SchedulerStatus;

    /** Runs this scheduler against a batch of tasks and returns one
     *  normalized metrics record. Never called while status is
     *  "disconnected" - the registry/UI guards that, not this function. */
    schedule(tasks: Task[]): Promise<SchedulingResult>;
}
// ── Event log (Section 9) ────────────────────────────────────────────────

export type EventSeverity = "info" | "success" | "warning" | "error";

export interface SchedulerEvent {
    id: string;
    timestamp: number;
    schedulerId?: SchedulerId; // absent for system-wide events (e.g. "Simulation started")
    severity: EventSeverity;
    message: string;
}

// ── Data-layer connection state (Section 12 + 13) ───────────────────────
// "demo": no real backend, dashboard is generating mock data itself.
// "connecting": a real backend/WebSocket connection is being attempted.
// "live": connected to a real backend and receiving real data.
// "disconnected": a real connection was expected but has dropped.
export type ConnectionStatus = "demo" | "connecting" | "live" | "disconnected";