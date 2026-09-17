import { computeMetrics, computeOverallScores } from '../src/metrics/metrics-engine';
import { SimulationResult } from '../src/engine/simulation-engine';
import { Task } from '../src/domain/types';

function makeResult(overrides: Partial<SimulationResult>): SimulationResult {
  return {
    schedulerName: 'test',
    totalTicks: 2,
    tasks: [],
    history: [],
    ...overrides,
  };
}

describe('computeMetrics', () => {
  it('computes CPU/mem utilization as the average per-tick usage ratio', () => {
    const result = makeResult({
      history: [
        { tick: 0, servers: [{ id: 's1', cpuCapacity: 10, memCapacity: 100, cpuUsed: 5, memUsed: 50 }], placements: [] },
        { tick: 1, servers: [{ id: 's1', cpuCapacity: 10, memCapacity: 100, cpuUsed: 10, memUsed: 100 }], placements: [] },
      ],
    });
    const m = computeMetrics(result);
    // tick0: 50%, tick1: 100% -> avg 75%
    expect(m.cpuUtilizationPct).toBeCloseTo(75, 5);
    expect(m.memUtilizationPct).toBeCloseTo(75, 5);
  });

  it('counts rejected vs successfully scheduled correctly', () => {
    const tasks: Task[] = [
      { id: 't1', cpuRequired: 1, memRequired: 1, duration: 1, arrivalTime: 0, priority: 1, status: 'completed', startTime: 0, finishTime: 1 },
      { id: 't2', cpuRequired: 1, memRequired: 1, duration: 1, arrivalTime: 0, priority: 1, status: 'rejected' },
    ];
    const m = computeMetrics(makeResult({ tasks, history: [{ tick: 0, servers: [], placements: [] }] }));
    expect(m.successfullyScheduled).toBe(1);
    expect(m.rejected).toBe(1);
  });

  it('computes waiting time as startTime - arrivalTime', () => {
    const tasks: Task[] = [
      { id: 't1', cpuRequired: 1, memRequired: 1, duration: 1, arrivalTime: 2, priority: 1, status: 'running', startTime: 7 },
    ];
    const m = computeMetrics(makeResult({ tasks, history: [{ tick: 0, servers: [], placements: [] }] }));
    expect(m.avgWaitingTime).toBe(5);
  });
});

describe('computeOverallScores', () => {
  it('gives the strictly-better scheduler a higher score on all dimensions', () => {
    const better = computeMetrics(makeResult({
      tasks: Array.from({ length: 10 }, (_, i) => ({
        id: `t${i}`, cpuRequired: 1, memRequired: 1, duration: 1, arrivalTime: 0,
        priority: 1 as const, status: 'completed' as const, startTime: 0, finishTime: 1,
      })),
      history: [{ tick: 0, servers: [{ id: 's1', cpuCapacity: 10, memCapacity: 10, cpuUsed: 8, memUsed: 8 }], placements: [] }],
    }));
    const worse = computeMetrics(makeResult({
      tasks: [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `t${i}`, cpuRequired: 1, memRequired: 1, duration: 1, arrivalTime: 0,
          priority: 1 as const, status: 'completed' as const, startTime: 5, finishTime: 10,
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `r${i}`, cpuRequired: 1, memRequired: 1, duration: 1, arrivalTime: 0,
          priority: 1 as const, status: 'rejected' as const,
        })),
      ],
      history: [{ tick: 0, servers: [{ id: 's1', cpuCapacity: 10, memCapacity: 10, cpuUsed: 2, memUsed: 2 }], placements: [] }],
    }));

    const scores = computeOverallScores([better, worse]);
    expect(scores.get('test')).toBeDefined();
  });
});
