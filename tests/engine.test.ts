import { runSimulation } from '../src/engine/simulation-engine';
import { Scheduler, Task, Server, SchedulingDecision } from '../src/domain/types';

// A deliberately malicious/broken scheduler used to prove the engine
// never trusts a scheduler's decision blindly.
class OverbookingScheduler implements Scheduler {
  readonly name = 'overbooking-test';
  schedule(pendingTasks: readonly Task[], _servers: readonly Server[], _t: number): SchedulingDecision[] {
    // tries to cram every pending task onto the same server regardless of capacity
    return pendingTasks.map(t => ({ taskId: t.id, serverId: 's1' }));
  }
}

describe('Simulation engine resource validation', () => {
  it('refuses a placement that would exceed real server capacity, even if the scheduler proposes it', () => {
    const servers = [{ id: 's1', cpuCapacity: 4, memCapacity: 4000 }];
    const tasks: Task[] = [
      { id: 't1', cpuRequired: 3, memRequired: 100, duration: 10, arrivalTime: 0, priority: 2, status: 'pending' },
      { id: 't2', cpuRequired: 3, memRequired: 100, duration: 10, arrivalTime: 0, priority: 2, status: 'pending' },
    ];
    const result = runSimulation(new OverbookingScheduler(), servers, tasks, 20);

    // both tasks together need 6 cpu but server only has 4 -> at most one can be running at once
    const runningOrCompletedAtOnce = result.history.every(
      snap => snap.servers[0].cpuUsed <= snap.servers[0].cpuCapacity,
    );
    expect(runningOrCompletedAtOnce).toBe(true);
  });

  it('marks a task still pending at simulation end as rejected', () => {
    const servers = [{ id: 's1', cpuCapacity: 1, memCapacity: 100 }];
    const tasks: Task[] = [
      { id: 't1', cpuRequired: 5, memRequired: 5, duration: 5, arrivalTime: 0, priority: 1, status: 'pending' },
    ];
    class NullScheduler implements Scheduler {
      readonly name = 'null';
      schedule(pending: readonly Task[]): SchedulingDecision[] {
        return pending.map(t => ({ taskId: t.id, serverId: null }));
      }
    }
    const result = runSimulation(new NullScheduler(), servers, tasks, 5);
    expect(result.tasks[0].status).toBe('rejected');
  });

  it('frees server resources once a task completes', () => {
    const servers = [{ id: 's1', cpuCapacity: 4, memCapacity: 4000 }];
    const tasks: Task[] = [
      { id: 't1', cpuRequired: 4, memRequired: 4000, duration: 3, arrivalTime: 0, priority: 2, status: 'pending' },
    ];
    class GreedyScheduler implements Scheduler {
      readonly name = 'greedy';
      schedule(pending: readonly Task[], servers: readonly Server[]): SchedulingDecision[] {
        return pending.map(t => ({ taskId: t.id, serverId: servers[0].id }));
      }
    }
    const result = runSimulation(new GreedyScheduler(), servers, tasks, 10);
    const finalSnap = result.history[result.history.length - 1];
    expect(finalSnap.servers[0].cpuUsed).toBe(0);
    expect(result.tasks[0].status).toBe('completed');
  });
});
