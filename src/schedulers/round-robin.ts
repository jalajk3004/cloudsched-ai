import { Scheduler, Task, Server, SchedulingDecision } from '../domain/types';

/**
 * Round-Robin: keeps a rotating pointer across servers (persists across
 * ticks, since RR is inherently stateful — a fresh instance must be created
 * per run so state doesn't leak between experiments). For each pending
 * task, scans forward from the pointer for the next server with enough
 * capacity, assigns, and advances the pointer past it.
 */
export class RoundRobinScheduler implements Scheduler {
  readonly name = 'round-robin';
  private pointer = 0;

  schedule(
    pendingTasks: ReadonlyArray<Task>,
    servers: ReadonlyArray<Server>,
    _currentTick: number,
  ): SchedulingDecision[] {
    if (servers.length === 0) return pendingTasks.map(t => ({ taskId: t.id, serverId: null }));

    const freeCpu = new Map(servers.map(s => [s.id, s.cpuCapacity - s.cpuUsed]));
    const freeMem = new Map(servers.map(s => [s.id, s.memCapacity - s.memUsed]));

    const decisions: SchedulingDecision[] = [];
    const ordered = [...pendingTasks].sort((a, b) => a.arrivalTime - b.arrivalTime);

    for (const task of ordered) {
      let placed = false;
      for (let i = 0; i < servers.length; i++) {
        const idx = (this.pointer + i) % servers.length;
        const server = servers[idx];
        const cpuLeft = freeCpu.get(server.id)!;
        const memLeft = freeMem.get(server.id)!;
        if (cpuLeft >= task.cpuRequired && memLeft >= task.memRequired) {
          decisions.push({ taskId: task.id, serverId: server.id });
          freeCpu.set(server.id, cpuLeft - task.cpuRequired);
          freeMem.set(server.id, memLeft - task.memRequired);
          this.pointer = (idx + 1) % servers.length; // advance past the server we just used
          placed = true;
          break;
        }
      }
      if (!placed) decisions.push({ taskId: task.id, serverId: null });
    }
    return decisions;
  }
}
