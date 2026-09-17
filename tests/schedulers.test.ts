import { FirstFitScheduler } from '../src/schedulers/first-fit';
import { BestFitScheduler } from '../src/schedulers/best-fit';
import { RoundRobinScheduler } from '../src/schedulers/round-robin';
import { Task, Server } from '../src/domain/types';

function task(id: string, cpu: number, mem: number, arrival = 0): Task {
  return { id, cpuRequired: cpu, memRequired: mem, duration: 5, arrivalTime: arrival, priority: 2, status: 'pending' };
}
function server(id: string, cpu: number, mem: number, cpuUsed = 0, memUsed = 0): Server {
  return { id, cpuCapacity: cpu, memCapacity: mem, cpuUsed, memUsed, runningTaskIds: [] };
}

describe('FirstFitScheduler', () => {
  it('assigns to the first server in list order that fits', () => {
    const servers = [server('s1', 4, 4000, 3, 0), server('s2', 4, 4000)];
    const decisions = new FirstFitScheduler().schedule([task('t1', 2, 100)], servers, 0);
    expect(decisions).toEqual([{ taskId: 't1', serverId: 's2' }]);
  });

  it('returns null serverId when nothing fits', () => {
    const servers = [server('s1', 1, 100)];
    const decisions = new FirstFitScheduler().schedule([task('t1', 2, 100)], servers, 0);
    expect(decisions[0].serverId).toBeNull();
  });
});

describe('BestFitScheduler', () => {
  it('picks the server with the smallest leftover capacity after placement', () => {
    // s1 leftover after placing 2cpu/100mem task = (4-2)+(4000-100)=3902
    // s2 leftover = (2-2)+(200-100)=100 <- tightest fit
    const servers = [server('s1', 4, 4000), server('s2', 2, 200)];
    const decisions = new BestFitScheduler().schedule([task('t1', 2, 100)], servers, 0);
    expect(decisions).toEqual([{ taskId: 't1', serverId: 's2' }]);
  });
});

describe('RoundRobinScheduler', () => {
  it('rotates across servers on successive schedule() calls', () => {
    const rr = new RoundRobinScheduler();
    const servers = [server('s1', 4, 4000), server('s2', 4, 4000)];
    const d1 = rr.schedule([task('t1', 1, 10)], servers, 0);
    const d2 = rr.schedule([task('t2', 1, 10)], servers, 1);
    expect(d1[0].serverId).toBe('s1');
    expect(d2[0].serverId).toBe('s2');
  });

  it('skips a full server and wraps to the next available one', () => {
    const rr = new RoundRobinScheduler();
    // s1 has no room, s2 does
    const servers = [server('s1', 1, 10, 1, 10), server('s2', 4, 4000)];
    const decisions = rr.schedule([task('t1', 2, 100)], servers, 0);
    expect(decisions[0].serverId).toBe('s2');
  });
});
