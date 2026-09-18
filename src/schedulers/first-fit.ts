import { Scheduler, Task, Server, SchedulingDecision, fits } from '../domain/types';

/**
 * First-Fit: for each pending task (in arrival order), scan servers in
 * list order and assign to the first one with enough free CPU and memory.
 *
 * Note: this scheduler simulates placement locally as it walks the task
 * list within a single tick, so two tasks in the same tick don't both get
 * assigned to a server that only has room for one of them. The engine
 * re-validates against the REAL server state afterward regardless.
 */
export class FirstFitScheduler implements Scheduler {
  readonly name = 'first-fit';

  schedule(
    pendingTasks: ReadonlyArray<Task>,
    servers: ReadonlyArray<Server>,
    _currentTick: number,
  ): SchedulingDecision[] {
    // local working copy of free capacity so we don't overbook within one tick
    const freeCpu = new Map(servers.map(s => [s.id, s.cpuCapacity - s.cpuUsed]));
    const freeMem = new Map(servers.map(s => [s.id, s.memCapacity - s.memUsed]));

    const decisions: SchedulingDecision[] = [];
    const ordered = [...pendingTasks].sort((a, b) => a.arrivalTime - b.arrivalTime);

    for (const task of ordered) {
      let placed = false;
      for (const server of servers) {
        const cpuLeft = freeCpu.get(server.id)!;
        const memLeft = freeMem.get(server.id)!;
        if (cpuLeft >= task.cpuRequired && memLeft >= task.memRequired) {
          decisions.push({ taskId: task.id, serverId: server.id });
          freeCpu.set(server.id, cpuLeft - task.cpuRequired);
          freeMem.set(server.id, memLeft - task.memRequired);
          placed = true;
          break;
        }
      }
      if (!placed) decisions.push({ taskId: task.id, serverId: null });
    }
    return decisions;
  }
}
