import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recordWorkloadRun, listWorkloadRuns, getWorkloadRunTasks } from '../../src/persistence/workload-store';
import { Task } from '../../src/domain/types';

function sampleTasks(): Task[] {
  return [
    { id: 't0', cpuRequired: 2, memRequired: 1024, duration: 5, arrivalTime: 0, priority: 2, status: 'pending' },
    { id: 't1', cpuRequired: 4, memRequired: 2048, duration: 10, arrivalTime: 3, priority: 3, status: 'pending' },
  ];
}

describe('workload-store persistence', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `workload-store-test-${Date.now()}-${Math.random()}.sqlite`);
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('records a workload run and lists it back with correct summary stats', async () => {
    await recordWorkloadRun(dbPath, 'synthetic', 'cpu-heavy', sampleTasks(), { seed: 'abc' });
    const runs = await listWorkloadRuns(dbPath);

    expect(runs.length).toBe(1);
    expect(runs[0].source).toBe('synthetic');
    expect(runs[0].label).toBe('cpu-heavy');
    expect(runs[0].taskCount).toBe(2);
    expect(runs[0].avgCpu).toBe(3); // (2+4)/2
    expect(runs[0].avgMem).toBe(1536); // (1024+2048)/2
  });

  it('retrieves the exact full task list for a recorded run', async () => {
    const id = await recordWorkloadRun(dbPath, 'huawei', 'data/huawei-east.csv', sampleTasks(), { csvPath: 'x' });
    const tasks = await getWorkloadRunTasks(dbPath, id);

    expect(tasks).not.toBeNull();
    expect(tasks!.length).toBe(2);
    expect(tasks![0].id).toBe('t0');
    expect(tasks![1].cpuRequired).toBe(4);
  });

  it('accumulates multiple runs, newest first', async () => {
    await recordWorkloadRun(dbPath, 'synthetic', 'balanced', sampleTasks(), {});
    await recordWorkloadRun(dbPath, 'azure', 'data/azure.sqlite', sampleTasks(), {});

    const runs = await listWorkloadRuns(dbPath);
    expect(runs.length).toBe(2);
    expect(runs[0].source).toBe('azure'); // most recent first
    expect(runs[1].source).toBe('synthetic');
  });

  it('returns an empty list when no database file exists yet', async () => {
    const runs = await listWorkloadRuns(path.join(os.tmpdir(), 'nonexistent-db-file.sqlite'));
    expect(runs).toEqual([]);
  });

  it('returns null for a run id that does not exist', async () => {
    await recordWorkloadRun(dbPath, 'synthetic', 'mixed', sampleTasks(), {});
    const tasks = await getWorkloadRunTasks(dbPath, 9999);
    expect(tasks).toBeNull();
  });
});
