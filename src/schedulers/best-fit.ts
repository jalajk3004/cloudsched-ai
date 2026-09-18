import { Scheduler, Task, Server, SchedulingDecision } from '../domain/types';

/**
 * Best-Fit: for each pending task, among all servers with enough free
 * capacity, pick the one that leaves the SMALLEST leftover capacity after
 * placement (i.e. the tightest fit). "Leftover" is defined once here as
 * (cpuLeft - cpuRequired) + (memLeft - memRequired) after hypothetical
 * placement — the same definition the AI policy's "leftover" feature uses,
 * so both are directly comparable.
 */
export class BestFitScheduler implements Scheduler {
  readonly name = 'best-fit';

  schedule(
    pendingTasks: ReadonlyArray<Task>,
    servers: ReadonlyArray<Server>,
    _currentTick: number,
  ): SchedulingDecision[] {
    const freeCpu = new Map(servers.map(s => [s.id, s.cpuCapacity - s.cpuUsed]));
    const freeMem = new Map(servers.map(s => [s.id, s.memCapacity - s.memUsed]));

    const decisions: SchedulingDecision[] = [];
    const ordered = [...pendingTasks].sort((a, b) => a.arrivalTime - b.arrivalTime);

    for (const task of ordered) {
      let bestServerId: string | null = null;
      let bestLeftover = Infinity;

      for (const server of servers) {
        const cpuLeft = freeCpu.get(server.id)!;
        const memLeft = freeMem.get(server.id)!;
        if (cpuLeft >= task.cpuRequired && memLeft >= task.memRequired) {
          const leftover = (cpuLeft - task.cpuRequired) + (memLeft - task.memRequired);
          if (leftover < bestLeftover) {
            bestLeftover = leftover;
            bestServerId = server.id;
          }
        }
      }

      if (bestServerId) {
        decisions.push({ taskId: task.id, serverId: bestServerId });
        freeCpu.set(bestServerId, freeCpu.get(bestServerId)! - task.cpuRequired);
        freeMem.set(bestServerId, freeMem.get(bestServerId)! - task.memRequired);
      } else {
        decisions.push({ taskId: task.id, serverId: null });
      }
    }
    return decisions;
  }
}
