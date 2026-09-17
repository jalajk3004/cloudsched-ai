// ── Core domain model ────────────────────────────────────────────────────
// This file is the single source of truth for shapes used across every
// scheduler (baseline or AI), the engine, and the metrics module.

export type TaskStatus = 'pending' | 'running' | 'completed' | 'rejected';
export type Priority = 1 | 2 | 3; // 1 = low, 2 = medium, 3 = high

export interface Task {
  id: string;
  cpuRequired: number;   // abstract CPU units
  memRequired: number;   // abstract MB units
  duration: number;      // ticks needed to run once started
  arrivalTime: number;   // simulated tick at which the task becomes visible
  priority: Priority;

  // Set by the engine only. Schedulers must never write these.
  status: TaskStatus;
  startTime?: number;
  finishTime?: number;
  assignedServerId?: string;
}

export interface Server {
  id: string;
  cpuCapacity: number;
  memCapacity: number;
  cpuUsed: number;
  memUsed: number;
  runningTaskIds: string[];
}

export interface SchedulingDecision {
  taskId: string;
  // null = "no placement this tick" (defer/reject-for-now).
  // The task stays pending and will be offered again next tick.
  serverId: string | null;
}


export interface Scheduler {
  readonly name: string;
  schedule(
    pendingTasks: ReadonlyArray<Task>,
    servers: ReadonlyArray<Server>,
    currentTick: number,
  ): SchedulingDecision[];
}

// Helper: pure function, no mutation — used by baselines & engine alike.
export function freeCpu(server: Server): number {
  return server.cpuCapacity - server.cpuUsed;
}
export function freeMem(server: Server): number {
  return server.memCapacity - server.memUsed;
}
export function fits(server: Server, task: Task): boolean {
  return freeCpu(server) >= task.cpuRequired && freeMem(server) >= task.memRequired;
}
