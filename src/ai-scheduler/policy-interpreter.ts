import { Scheduler, Task, Server, SchedulingDecision } from '../domain/types';
import { PolicyProposal, PolicyFeature } from './llm-provider';

/**
 * Computes the whitelisted feature values for one (task, server) pair.
 * This is the ONLY place a policy's weights get multiplied against real
 * numbers - adding a new feature means adding it here AND to
 * ALLOWED_POLICY_FEATURES in llm-provider.ts, never anywhere else.
 */
function computeFeatures(
  task: Task,
  server: Server,
  maxWaitSoFar: number,
): Record<PolicyFeature, number> {
  const cpuFree = server.cpuCapacity - server.cpuUsed;
  const memFree = server.memCapacity - server.memUsed;
  const leftoverCpuAfterPlacement = cpuFree - task.cpuRequired;
  const leftoverMemAfterPlacement = memFree - task.memRequired;
  const serverCurrentUtilization =
    server.cpuCapacity > 0 ? server.cpuUsed / server.cpuCapacity : 0;
  const taskPriority = task.priority / 3; // normalize 1..3 -> ~0.33..1
  const taskWaitTime = maxWaitSoFar > 0 ? (task as any)._waitSoFar / maxWaitSoFar : 0;

  return {
    leftoverCpuAfterPlacement,
    leftoverMemAfterPlacement,
    serverCurrentUtilization,
    taskPriority,
    taskWaitTime,
  };
}

/**
 * A Scheduler implementation whose decisions come entirely from a fixed,
 * already-validated PolicyProposal, not from any live LLM call. This is
 * what actually runs during both the search phase (on the small sample)
 * and the frozen timed comparison (on the full workload) - identical
 * code path either way.
 */
export class PolicyInterpreterScheduler implements Scheduler {
  readonly name: string;

  constructor(private policy: PolicyProposal, private currentTick0 = 0) {
    this.name = `ai-scheduler(${policy.policyName})`;
  }

  schedule(
    pendingTasks: ReadonlyArray<Task>,
    servers: ReadonlyArray<Server>,
    currentTick: number,
  ): SchedulingDecision[] {
    const freeCpu = new Map(servers.map(s => [s.id, s.cpuCapacity - s.cpuUsed]));
    const freeMem = new Map(servers.map(s => [s.id, s.memCapacity - s.memUsed]));
    const maxWait = Math.max(1, ...pendingTasks.map(t => currentTick - t.arrivalTime));

    const decisions: SchedulingDecision[] = [];
    const ordered = [...pendingTasks].sort((a, b) => a.arrivalTime - b.arrivalTime);

    for (const task of ordered) {
      const waitSoFar = currentTick - task.arrivalTime;
      (task as any)._waitSoFar = waitSoFar;

      let bestServerId: string | null = null;
      let bestScore = -Infinity;

      for (const server of servers) {
        const cpuLeft = freeCpu.get(server.id)!;
        const memLeft = freeMem.get(server.id)!;
        if (cpuLeft < task.cpuRequired || memLeft < task.memRequired) continue; // doesn't fit, skip

        const virtualServer: Server = { ...server, cpuUsed: server.cpuCapacity - cpuLeft, memUsed: server.memCapacity - memLeft };
        const features = computeFeatures(task, virtualServer, maxWait);

        let score = 0;
        for (const [feature, weight] of Object.entries(this.policy.weights)) {
          score += (weight as number) * features[feature as PolicyFeature];
        }

        if (bestServerId === null || score > bestScore) {
          bestScore = score;
          bestServerId = server.id;
        } else if (score === bestScore) {
          // tie-break: pick according to the policy's declared rule
          const preferThis =
            this.policy.tieBreak === 'lowest_server_index'
              ? server.id < bestServerId
              : server.id > bestServerId;
          if (preferThis) bestServerId = server.id;
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
