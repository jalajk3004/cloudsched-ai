// ── Core domain model ────────────────────────────────────────────────────
export type TaskStatus = 'pending' | 'running' | 'completed' | 'rejected' | 'unresolved';
// 'rejected'   = permanently infeasible: fits on NO server even when that server is empty (see rejectionReason)
// 'unresolved' = still pending or running when the hard simulation limit was reached
export type Priority = 1 | 2 | 3; // 1 = low, 2 = medium, 3 = high

export interface Task {
  id: string;
  cpuRequired: number;
  memRequired: number;
  duration: number;      // ticks needed to run once started
  arrivalTime: number;   // simulated tick at which the task becomes visible
  priority: Priority;

  // Set by the engine only. Schedulers can never write these.
  status: TaskStatus;
  startTime?: number;
  finishTime?: number;
  assignedServerId?: string;
  rejectionReason?: 'infeasible';
}

export interface Server {
  id: string;
  cpuCapacity: number;
  memCapacity: number;
  cpuUsed: number;
  memUsed: number;
  runningTaskIds: string[];
}

/** What a scheduler is allowed to see: frozen snapshots, never the engine's live objects. */
export type TaskView = Readonly<Task>;
export type ServerView = Readonly<Omit<Server, 'runningTaskIds'>> & { readonly runningTaskIds: ReadonlyArray<string> };

export interface SchedulingDecision {
  taskId: string;
  serverId: string | null; // null = "no placement this tick"; the task stays pending
}

export interface Scheduler {
  readonly name: string;
  schedule(
    pendingTasks: ReadonlyArray<TaskView>,
    servers: ReadonlyArray<ServerView>,
    currentTick: number,
  ): SchedulingDecision[];
}

type HasCpu = Pick<Server, 'cpuCapacity' | 'cpuUsed'>;
type HasMem = Pick<Server, 'memCapacity' | 'memUsed'>;
export function freeCpu(server: HasCpu): number { return server.cpuCapacity - server.cpuUsed; }
export function freeMem(server: HasMem): number { return server.memCapacity - server.memUsed; }
export function fits(server: HasCpu & HasMem, task: Pick<Task, 'cpuRequired' | 'memRequired'>): boolean {
  return freeCpu(server) >= task.cpuRequired && freeMem(server) >= task.memRequired;
}