import { Task, Server, Scheduler, SchedulingDecision } from '../domain/types';

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
  totalTicks: number;
  tasks: Task[];              // final state of every task (completed/rejected/etc.)
  history: TickSnapshot[];    // per-tick server utilization + placement log
}

/**
 * Runs one full simulation of `tasks` against `serverConfigs` using
 * `scheduler`, for `simulationDuration` ticks (or until all tasks resolve,
 * whichever is longer — capped by simulationDuration as a hard stop so a
 * run can never hang).
 *
 * This function is scheduler-agnostic by construction: it only ever calls
 * `scheduler.schedule(...)` through the common interface, and independently
 * re-validates every returned decision against live resource state before
 * committing it. No scheduler — baseline or AI — can force an invalid
 * placement or read tasks that haven't arrived yet.
 */
export function runSimulation(
  scheduler: Scheduler,
  serverConfigs: ServerConfig[],
  taskQueue: Task[], // full generated workload, with arrivalTime already assigned
  simulationDuration: number,
): SimulationResult {
  const servers: Server[] = serverConfigs.map(c => ({
    id: c.id,
    cpuCapacity: c.cpuCapacity,
    memCapacity: c.memCapacity,
    cpuUsed: 0,
    memUsed: 0,
    runningTaskIds: [],
  }));

  // Deep-copy tasks so repeated runs (different schedulers) never share mutable state.
  // Deep-copy tasks so repeated runs (different schedulers) never share mutable state.
  const tasks: Task[] = taskQueue.map(t => ({ ...t, status: 'pending' as const }));
  const taskById = new Map(tasks.map(t => [t.id, t]));

  // Bucket tasks by arrival tick ONCE up front, instead of scanning the
  // entire task list on every single tick. For a large task list run
  // over a wide tick range, the old approach (O(tasks) work per tick)
  // could balloon into billions of operations - this makes it O(tasks)
  // total, regardless of how many ticks the simulation runs for.
  const tasksByArrivalTick = new Map<number, Task[]>();
  for (const task of tasks) {
    const bucket = tasksByArrivalTick.get(task.arrivalTime);
    if (bucket) bucket.push(task);
    else tasksByArrivalTick.set(task.arrivalTime, [task]);
  }

  let pendingIds = new Set<string>(); // tasks currently visible & unplaced
  const history: TickSnapshot[] = [];

  const lastArrival = Math.max(0, ...tasks.map(t => t.arrivalTime));
  const maxTick = Math.max(simulationDuration, lastArrival + 1);

  // Safety guard: a bad unit-conversion assumption upstream (e.g. treating
  // a raw dataset's time column as the wrong unit) can turn into an
  // astronomical tick count, which would otherwise silently try to
  // allocate a history entry per tick until the process runs out of
  // memory. Fail fast with a clear message instead.
  const MAX_REASONABLE_TICKS = 200_000;
  if (maxTick > MAX_REASONABLE_TICKS) {
    throw new Error(
      `Simulation would run for ${maxTick} ticks, which exceeds the safety limit of ${MAX_REASONABLE_TICKS}. ` +
      `This usually means a task's arrivalTime is far larger than expected - check the time-unit conversion ` +
      `in whichever workload source produced these tasks (e.g. ticksPerSecond/ticksPerDay in the data adapter).`,
    );
  }

  for (let t = 0; t < maxTick; t++) {
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

    // 2) reveal newly-arrived tasks (fairness guard: never reveal the future)
    const arrivingNow = tasksByArrivalTick.get(t);
    if (arrivingNow) {
      for (const task of arrivingNow) {
        if (task.status === 'pending') pendingIds.add(task.id);
      }
    }

    const pendingTasks = [...pendingIds].map(id => taskById.get(id)!);

    // 3) ask the scheduler — it only sees current pending tasks + current server state
    const decisions: SchedulingDecision[] = pendingTasks.length
      ? scheduler.schedule(pendingTasks, servers, t)
      : [];

    // 4) apply decisions — engine independently re-validates every one
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

      const cpuFree = server.cpuCapacity - server.cpuUsed;
      const memFree = server.memCapacity - server.memUsed;
      const valid = task.cpuRequired <= cpuFree && task.memRequired <= memFree;

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
      servers: servers.map(s => ({
        id: s.id, cpuUsed: s.cpuUsed, memUsed: s.memUsed,
        cpuCapacity: s.cpuCapacity, memCapacity: s.memCapacity,
      })),
      placements: placementLog,
    });
  }

  // anything still pending when the simulation ends is officially rejected
  for (const id of pendingIds) {
    taskById.get(id)!.status = 'rejected';
  }

  return { schedulerName: scheduler.name, totalTicks: maxTick, tasks, history };
}
