import { runSimulation } from '../src/engine/simulation-engine';
import { FirstFitScheduler } from '../src/schedulers/first-fit';
import { Scheduler, Task } from '../src/domain/types';

const servers = [{ id: 's1', cpuCapacity: 8, memCapacity: 8192 }];
const t = (id: string, o: Partial<Task> = {}): Task => ({
    id, cpuRequired: 2, memRequired: 1024, duration: 5, arrivalTime: 0, priority: 2, status: 'pending', ...o,
});

describe('simulation engine', () => {
    it('keeps running until late-starting tasks finish', () => {
        const r = runSimulation(new FirstFitScheduler(), servers, [t('late', { arrivalTime: 99, duration: 15 })], 100);
        expect(r.drained).toBe(true);
        expect(r.tasks[0].status).toBe('completed');
        expect(r.tasks[0].finishTime).toBe(114);
    });

    it('rejects permanently infeasible tasks without letting them occupy the queue', () => {
        const r = runSimulation(new FirstFitScheduler(), servers, [t('big', { cpuRequired: 9 }), t('ok')], 10);
        const big = r.tasks.find(x => x.id === 'big')!;
        expect(big.status).toBe('rejected');
        expect(big.rejectionReason).toBe('infeasible');
        expect(r.tasks.find(x => x.id === 'ok')!.status).toBe('completed');
        expect(r.drained).toBe(true);
    });

    it.each([
        ['duplicate task id', [t('a'), t('a')]],
        ['fractional arrival', [t('a', { arrivalTime: 2.5 })]],
        ['negative arrival', [t('a', { arrivalTime: -1 })]],
        ['zero duration', [t('a', { duration: 0 })]],
        ['fractional duration', [t('a', { duration: 1.5 })]],
        ['zero cpu', [t('a', { cpuRequired: 0 })]],
        ['bad priority', [t('a', { priority: 5 as any })]],
    ])('rejects invalid input: %s', (_label, tasks) => {
        expect(() => runSimulation(new FirstFitScheduler(), servers, tasks as Task[], 10)).toThrow(/Invalid simulation input/);
    });

    it('rejects invalid servers and durations', () => {
        expect(() => runSimulation(new FirstFitScheduler(), [{ id: 's1', cpuCapacity: 0, memCapacity: 1 }], [t('a')], 10)).toThrow();
        expect(() => runSimulation(new FirstFitScheduler(), [...servers, ...servers], [t('a')], 10)).toThrow(/duplicate server id/);
        expect(() => runSimulation(new FirstFitScheduler(), servers, [t('a')], 0)).toThrow();
    });

    it('clears stale engine fields and never mutates the input workload', () => {
        const dirty = t('a', { status: 'completed', startTime: 99, finishTime: 100, assignedServerId: 'zzz' });
        const before = JSON.stringify([dirty]);
        const r = runSimulation(new FirstFitScheduler(), servers, [dirty], 10);
        expect(JSON.stringify([dirty])).toBe(before);
        expect(r.tasks[0].startTime).toBe(0);
        expect(r.tasks[0].finishTime).toBe(5);
        expect(r.tasks[0].assignedServerId).toBe('s1');
    });

    it('marks tasks unresolved (never completed) when the hard limit is reached', () => {
        const tasks = [t('a', { cpuRequired: 8, duration: 50 }), t('b', { cpuRequired: 8, duration: 50 })];
        const r = runSimulation(new FirstFitScheduler(), servers, tasks, 1, { drainLimitTicks: 1 });
        expect(r.drained).toBe(false);
        expect(r.tasks.every(x => x.status === 'unresolved')).toBe(true);
    });

    it('hands schedulers frozen snapshots', () => {
        const mutator: Scheduler = { name: 'mutator', schedule(pending) { (pending[0] as any).status = 'completed'; return []; } };
        expect(() => runSimulation(mutator, servers, [t('a')], 10)).toThrow();
    });

    it('never over-allocates a server, even for a scheduler that over-books', () => {
        const greedy: Scheduler = { name: 'greedy', schedule: p => p.map(x => ({ taskId: x.id, serverId: 's1' })) };
        const tasks = Array.from({ length: 5 }, (_, i) => t(`t${i}`, { cpuRequired: 4 }));
        const r = runSimulation(greedy, servers, tasks, 5);
        for (const snap of r.history) for (const s of snap.servers) expect(s.cpuUsed).toBeLessThanOrEqual(s.cpuCapacity);
        expect(r.tasks.every(x => x.status === 'completed')).toBe(true);
    });
});