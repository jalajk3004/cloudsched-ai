import {
  computeMetrics, averageMetrics, computeObjectiveScore, computeOverallScores, relativeScore, Metrics,
} from '../src/metrics/metrics-engine';
import { SimulationResult } from '../src/engine/simulation-engine';
import { Task } from '../src/domain/types';

const task = (id: string, o: Partial<Task> = {}): Task => ({
  id, cpuRequired: 1, memRequired: 1, duration: 4, arrivalTime: 0, priority: 2, status: 'completed', ...o,
});
const snap = (tick: number, cpuUsed: number, memUsed: number) => ({
  tick, placements: [], servers: [{ id: 's1', cpuUsed, memUsed, cpuCapacity: 10, memCapacity: 100 }],
});
const result = (tasks: Task[], history = [snap(0, 0, 0)], arrivalWindow = 1): SimulationResult =>
  ({ schedulerName: 's', totalTicks: history.length, arrivalWindow, drained: true, tasks, history });

const M = (o: Partial<Metrics> = {}): Metrics => ({
  schedulerName: 'x', tasksTotal: 10, completed: 10, rejectedInfeasible: 0, unresolved: 0, completionRate: 1,
  avgWaitingTime: 5, p95WaitingTime: 10, maxWaitingTime: 12, avgTurnaroundTime: 15, avgSlowdown: 1.5,
  avgWaitP1: 0, avgWaitP2: 0, avgWaitP3: 0, makespan: 100,
  cpuUtilizationPct: 80, memUtilizationPct: 40, wastedCpu: 0, wastedMem: 0,
  successfullyScheduled: 10, rejected: 0, ...o,
});

describe('computeMetrics', () => {
  it('counts outcomes and excludes infeasible tasks from the completion rate', () => {
    const m = computeMetrics(result([
      task('a', { startTime: 2, finishTime: 6 }),
      task('b', { arrivalTime: 1, startTime: 1, finishTime: 5 }),
      task('c', { status: 'rejected', rejectionReason: 'infeasible' }),
      task('d', { status: 'unresolved' }),
    ]));
    expect(m.tasksTotal).toBe(4);
    expect(m.completed).toBe(2);
    expect(m.rejectedInfeasible).toBe(1);
    expect(m.unresolved).toBe(1);
    expect(m.completionRate).toBeCloseTo(2 / 3, 10);   // 2 completed / (4 - 1 infeasible)
    expect(m.successfullyScheduled).toBe(2);
    expect(m.rejected).toBe(2);                         // infeasible + unresolved
  });

  it('computes waiting, turnaround, slowdown and makespan on completed tasks only', () => {
    const m = computeMetrics(result([
      task('a', { startTime: 2, finishTime: 6 }),                    // wait 2, turnaround 6, slowdown 1.5
      task('b', { arrivalTime: 1, startTime: 1, finishTime: 5 }),    // wait 0, turnaround 4, slowdown 1
      task('d', { status: 'unresolved', startTime: 3 }),             // must not influence latency
    ]));
    expect(m.avgWaitingTime).toBeCloseTo(1, 10);
    expect(m.avgTurnaroundTime).toBeCloseTo(5, 10);
    expect(m.avgSlowdown).toBeCloseTo(1.25, 10);
    expect(m.maxWaitingTime).toBe(2);
    expect(m.makespan).toBe(6);
  });

  it('uses the nearest-rank percentile (P95 of waits 1..20 is 19)', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task(`t${i}`, { startTime: i + 1, finishTime: i + 5 }));
    const m = computeMetrics(result(tasks));
    expect(m.p95WaitingTime).toBe(19);
    expect(m.maxWaitingTime).toBe(20);
  });

  it('measures utilization and waste over the arrival window only', () => {
    const history = [snap(0, 5, 50), snap(1, 5, 50), snap(2, 10, 100)];
    const m = computeMetrics(result([task('a', { startTime: 0, finishTime: 4 })], history, 2));
    expect(m.cpuUtilizationPct).toBeCloseTo(50, 10);   // (5+5)/(10+10)
    expect(m.memUtilizationPct).toBeCloseTo(50, 10);
    expect(m.wastedCpu).toBe(10);                      // CPU-ticks: 5 + 5
    expect(m.wastedMem).toBe(100);                     // MB-ticks: 50 + 50
  });

  it('reports waiting time per priority class', () => {
    const m = computeMetrics(result([
      task('l', { priority: 1, startTime: 4, finishTime: 8 }),
      task('h', { priority: 3, startTime: 0, finishTime: 4 }),
    ]));
    expect(m.avgWaitP1).toBe(4);
    expect(m.avgWaitP3).toBe(0);
    expect(m.avgWaitP2).toBe(0); // empty class convention
  });
});

describe('objective', () => {
  it('matches the documented formula at a known point', () => {
    // J = .30*1 + .25*(1/(1+5/20)) + .15*(1/(1+15/30)) + .15*.8 + .15*.4
    expect(computeObjectiveScore(M())).toBeCloseTo(0.3 + 0.25 * 0.8 + 0.15 * (2 / 3) + 0.12 + 0.06, 8);
  });

  it('is bounded to [0, 1]', () => {
    const worst = M({ completionRate: 0, completed: 0, avgWaitingTime: 1e9, avgTurnaroundTime: 1e9, cpuUtilizationPct: 0, memUtilizationPct: 0 });
    const best = M({ avgWaitingTime: 0, avgTurnaroundTime: 0, cpuUtilizationPct: 100, memUtilizationPct: 100 });
    expect(computeObjectiveScore(worst)).toBeGreaterThanOrEqual(0);
    expect(computeObjectiveScore(best)).toBeLessThanOrEqual(1);
  });

  it('improves when waiting falls, and never saturates under heavy load', () => {
    expect(computeObjectiveScore(M({ avgWaitingTime: 2 }))).toBeGreaterThan(computeObjectiveScore(M({ avgWaitingTime: 8 })));
    expect(computeObjectiveScore(M({ avgWaitingTime: 40, avgTurnaroundTime: 60 })))
      .toBeGreaterThan(computeObjectiveScore(M({ avgWaitingTime: 60, avgTurnaroundTime: 80 })));
  });

  it('gives no latency credit when nothing completed', () => {
    const m = M({ completed: 0, completionRate: 0, avgWaitingTime: 0, avgTurnaroundTime: 0 });
    expect(computeObjectiveScore(m)).toBeCloseTo(0.15 * 0.8 + 0.15 * 0.4, 8);
  });

  it('is independent of which schedulers are compared', () => {
    const a = M({ schedulerName: 'a' });
    expect(computeObjectiveScore(a)).toBe(computeObjectiveScore({ ...a }));
  });

  it('computeOverallScores is a difference to best-fit; relativeScore agrees', () => {
    const bf = M({ schedulerName: 'best-fit' });
    const other = M({ schedulerName: 'other', avgWaitingTime: 2 });
    const scores = computeOverallScores([bf, other]);
    expect(scores.get('best-fit')).toBeCloseTo(0, 12);
    expect(scores.get('other')).toBeCloseTo(relativeScore(other, bf), 12);
    expect(() => computeOverallScores([other])).toThrow();
  });
});

describe('averageMetrics', () => {
  it('averages numeric fields', () => {
    const avg = averageMetrics([M({ avgWaitingTime: 2 }), M({ avgWaitingTime: 6 })]);
    expect(avg.avgWaitingTime).toBe(4);
    expect(avg.schedulerName).toBe('x');
  });
  it('refuses empty lists and mixed scheduler names', () => {
    expect(() => averageMetrics([])).toThrow();
    expect(() => averageMetrics([M({ schedulerName: 'a' }), M({ schedulerName: 'b' })])).toThrow();
  });
});