import { Scheduler, SchedulingDecision, TaskView, ServerView } from '../domain/types';

/**
 * Best-Fit: among servers with enough free capacity, pick the one with the SMALLEST
 * residual after placement, where the residual is measured in dimensionless fractions
 * of that server's capacity:
 *     residual_j = (cpuFree_j - cpu_i) / CPU_j  +  (memFree_j - mem_i) / MEM_j
 * Units cancel, so the decision no longer depends on whether memory is counted in MB or GB.
 */
export class BestFitScheduler implements Scheduler {
  readonly name = 'best-fit';

  schedule(
    pendingTasks: ReadonlyArray<TaskView>,
    servers: ReadonlyArray<ServerView>,
    _currentTick: number,
  ): SchedulingDecision[] {
    const freeCpu = new Map(servers.map(s => [s.id, s.cpuCapacity - s.cpuUsed]));
    const freeMem = new Map(servers.map(s => [s.id, s.memCapacity - s.memUsed]));

    const decisions: SchedulingDecision[] = [];
    const ordered = [...pendingTasks].sort((a, b) => a.arrivalTime - b.arrivalTime);

    for (const task of ordered) {
      let bestServerId: string | null = null;
      let bestResidual = Infinity;

      for (const server of servers) {
        const cpuLeft = freeCpu.get(server.id)!;
        const memLeft = freeMem.get(server.id)!;
        if (cpuLeft >= task.cpuRequired && memLeft >= task.memRequired) {
          const residual =
            (cpuLeft - task.cpuRequired) / server.cpuCapacity +
            (memLeft - task.memRequired) / server.memCapacity;
          if (residual < bestResidual) { // strict: ties go to the lowest server index
            bestResidual = residual;
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