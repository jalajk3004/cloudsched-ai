import { Task, Server, Scheduler, SchedulingDecision, TaskView, ServerView } from '../domain/types';

export interface ServerConfig {
  id: string;
  cpuCapacity: number;
  memCapacity: number;
}

export interface TickSnapshot {
  tick: number;
  servers: { id: string; cpuUsed: number; memUsed: number; cpuCapacity: number; memCapacity: number }[];
  placements: { taskId: string; serverId: string | null; accepted: boolean }[];
}

export interface SimulationResult {
  schedulerName: string;
  totalTicks: number;     // ticks actually simulated (arrival window + drain)
  arrivalWindow: number;  // ticks during which tasks may arrive
  drained: boolean;       // true = every task reached a final outcome before the hard limit
  tasks: Task[];          // final state of every task
  history: TickSnapshot[];
}

export interface SimulationOptions {
  /** Max extra ticks after the arrival window for queued/running tasks to finish. Default: max(1000, 10 x window). */
  drainLimitTicks?: number;
}

const MAX_REASONABLE_TICKS = 200_000;

/** Rejects invalid configurations immediately, with every problem listed. */
export function validateSimulationInput(serverConfigs: ServerConfig[], tasks: Task[], simulationDuration: number): void {
  const errors: string[] = [];
  const posFinite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

  if (!Number.isInteger(simulationDuration) || simulationDuration <= 0) {
    errors.push(`simulationDuration must be a positive integer (got ${simulationDuration})`);
  }
  if (serverConfigs.length === 0) errors.push('at least one server is required');

  const serverIds = new Set<string>();
  for (const s of serverConfigs) {
    if (typeof s.id !== 'string' || s.id === '') errors.push('server id must be a non-empty string');
    else if (serverIds.has(s.id)) errors.push(`duplicate server id "${s.id}"`);
    serverIds.add(s.id);
    if (!posFinite(s.cpuCapacity)) errors.push(`server "${s.id}": cpuCapacity must be a positive finite number`);
    if (!posFinite(s.memCapacity)) errors.push(`server "${s.id}": memCapacity must be a positive finite number`);
  }

  const taskIds = new Set<string>();
  for (const t of tasks) {
    if (typeof t.id !== 'string' || t.id === '') errors.push('task id must be a non-empty string');
    else if (taskIds.has(t.id)) errors.push(`duplicate task id "${t.id}"`);
    taskIds.add(t.id);
    if (!posFinite(t.cpuRequired)) errors.push(`task "${t.id}": cpuRequired must be a positive finite number`);
    if (!posFinite(t.memRequired)) errors.push(`task "${t.id}": memRequired must be a positive finite number`);
    if (!Number.isInteger(t.duration) || t.duration < 1) errors.push(`task "${t.id}": duration must be an integer >= 1 (got ${t.duration})`);
    if (!Number.isInteger(t.arrivalTime) || t.arrivalTime < 0) errors.push(`task "${t.id}": arrivalTime must be an integer >= 0 (got ${t.arrivalTime})`);
    if (t.priority !== 1 && t.priority !== 2 && t.priority !== 3) errors.push(`task "${t.id}": priority must be 1, 2 or 3 (got ${t.priority})`);
  }

  if (errors.length > 0) {
    const shown = errors.slice(0, 10).map(e => `  - ${e}`).join('\n');
    throw new Error(`Invalid simulation input (${errors.length} problem(s)):\n${shown}${errors.length > 10 ? '\n  ...' : ''}`);
  }
}

export function runSimulation(
  scheduler: Scheduler,
  serverConfigs: ServerConfig[],
  taskQueue: Task[],
  simulationDuration: number,
  options: SimulationOptions = {},
): SimulationResult {
  validateSimulationInput(serverConfigs, taskQueue, simulationDuration);

  const servers: Server[] = serverConfigs.map(c => ({
    id: c.id, cpuCapacity: c.cpuCapacity, memCapacity: c.memCapacity, cpuUsed: 0, memUsed: 0, runningTaskIds: [],
  }));

  // Fresh runtime state: copy ONLY the workload fields, so no stale startTime/finishTime/assignedServerId can leak in.
  const tasks: Task[] = taskQueue.map(t => ({
    id: t.id, cpuRequired: t.cpuRequired, memRequired: t.memRequired, duration: t.duration,
    arrivalTime: t.arrivalTime, priority: t.priority, status: 'pending' as const,
  }));
  const taskById = new Map(tasks.map(t => [t.id, t]));

  // Static feasibility: a task that fits no server even when empty can never run -> permanent rejection.
  const isFeasible = (t: Task) => servers.some(s => t.cpuRequired <= s.cpuCapacity && t.memRequired <= s.memCapacity);
  const tasksByArrivalTick = new Map<number, Task[]>();
  let lastArrival = 0;
  for (const task of tasks) {
    if (!isFeasible(task)) { task.status = 'rejected'; task.rejectionReason = 'infeasible'; continue; }
    lastArrival = Math.max(lastArrival, task.arrivalTime);
    const bucket = tasksByArrivalTick.get(task.arrivalTime);
    if (bucket) bucket.push(task); else tasksByArrivalTick.set(task.arrivalTime, [task]);
  }

  const arrivalWindow = Math.max(simulationDuration, lastArrival + 1);
  if (arrivalWindow > MAX_REASONABLE_TICKS) {
    throw new Error(
      `Arrival window of ${arrivalWindow} ticks exceeds the safety limit of ${MAX_REASONABLE_TICKS}. ` +
      `Check the time-unit conversion in the workload source (e.g. ticksPerSecond/ticksPerDay).`,
    );
  }
  const drainLimit = options.drainLimitTicks ?? Math.max(1000, 10 * arrivalWindow);
  const hardLimit = Math.min(arrivalWindow + drainLimit, MAX_REASONABLE_TICKS);

  const pendingIds = new Set<string>();
  const history: TickSnapshot[] = [];
  let ticksRun = 0;
  let drained = false;

  for (let t = 0; t < hardLimit; t++) {
    ticksRun = t + 1;

    // 1) free resources from tasks finishing at this tick
    for (const server of servers) {
      const stillRunning: string[] = [];
      for (const taskId of server.runningTaskIds) {
        const task = taskById.get(taskId)!;
        if (task.finishTime !== undefined && task.finishTime <= t) {
          server.cpuUsed -= task.cpuRequired;
          server.memUsed -= task.memRequired;
          task.status = 'completed';
        } else {
          stillRunning.push(taskId);
        }
      }
      server.runningTaskIds = stillRunning;
    }

    // 2) reveal newly arrived (feasible) tasks; the future is never visible
    const arrivingNow = tasksByArrivalTick.get(t);
    if (arrivingNow) for (const task of arrivingNow) pendingIds.add(task.id);

    // 3) ask the scheduler, giving it FROZEN snapshots, never the engine's live objects
    let decisions: SchedulingDecision[] = [];
    if (pendingIds.size > 0) {
      const pendingView = [...pendingIds].map(id => Object.freeze({ ...taskById.get(id)! })) as unknown as ReadonlyArray<TaskView>;
      const serverView = servers.map(s =>
        Object.freeze({ ...s, runningTaskIds: Object.freeze([...s.runningTaskIds]) })) as unknown as ReadonlyArray<ServerView>;
      decisions = scheduler.schedule(pendingView, serverView, t);
    }

    // 4) apply decisions; the engine independently re-validates every one
    const placementLog: TickSnapshot['placements'] = [];
    for (const d of decisions) {
      if (d.serverId === null) {
        placementLog.push({ taskId: d.taskId, serverId: null, accepted: false });
        continue; // stays pending, retried next tick
      }
      const task = taskById.get(d.taskId);
      const server = servers.find(s => s.id === d.serverId);
      if (!task || !server || task.status !== 'pending' || !pendingIds.has(task.id)) {
        placementLog.push({ taskId: d.taskId, serverId: d.serverId, accepted: false });
        continue;
      }
      const valid =
        task.cpuRequired <= server.cpuCapacity - server.cpuUsed &&
        task.memRequired <= server.memCapacity - server.memUsed;
      if (valid) {
        server.cpuUsed += task.cpuRequired;
        server.memUsed += task.memRequired;
        server.runningTaskIds.push(task.id);
        task.status = 'running';
        task.startTime = t;
        task.finishTime = t + task.duration;
        task.assignedServerId = server.id;
        pendingIds.delete(task.id);
      }
      placementLog.push({ taskId: d.taskId, serverId: d.serverId, accepted: valid });
    }

    history.push({
      tick: t,
      servers: servers.map(s => ({ id: s.id, cpuUsed: s.cpuUsed, memUsed: s.memUsed, cpuCapacity: s.cpuCapacity, memCapacity: s.memCapacity })),
      placements: placementLog,
    });

    // 5) done when every arrival has been revealed and nothing is queued or running
    if (t >= lastArrival && pendingIds.size === 0 && servers.every(s => s.runningTaskIds.length === 0)) {
      drained = true;
      break;
    }
  }

  // Anything not finished at the hard limit is UNRESOLVED, never silently counted as a success.
  for (const task of tasks) {
    if (task.status === 'pending' || task.status === 'running') task.status = 'unresolved';
  }

  return { schedulerName: scheduler.name, totalTicks: ticksRun, arrivalWindow, drained, tasks, history };
}