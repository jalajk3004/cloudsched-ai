import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildFixtureDb } from '../fixtures/build-fixture-db';
import { loadRealWorkload } from '../../src/workload/real-data-adapter';

describe('loadRealWorkload (real-data adapter)', () => {
  let dbPath: string;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `cloudsched-fixture-${Date.now()}.db`);
    await buildFixtureDb(dbPath);
  });

  afterAll(() => {
    fs.unlinkSync(dbPath);
  });

  it('only returns valid rows (drops negative starttime and null endtime)', async () => {
    const tasks = await loadRealWorkload({ dbPath });
    // fixture has 5 rows total, 2 of which are invalid -> expect exactly 3
    expect(tasks.length).toBe(3);
  });

  it('scales fractional core/memory into our absolute CPU/MB units', async () => {
    const tasks = await loadRealWorkload({ dbPath, cpuUnitsPerMachine: 8, memUnitsPerMachine: 8192 });
    // vmId 1 used vmTypeId 100 -> core=0.5, memory=0.25
    const t1 = tasks.find(t => t.id.startsWith('real-1-'));
    expect(t1!.cpuRequired).toBe(Math.round(0.5 * 8));   // 4
    expect(t1!.memRequired).toBe(Math.round(0.25 * 8192)); // 2048
  });

  it('maps source priority (0=high,1=low) onto our 1..3 scale', async () => {
    const tasks = await loadRealWorkload({ dbPath });
    const highPriorityTask = tasks.find(t => t.id.startsWith('real-1-')); // priority 0 in fixture
    const lowPriorityTask = tasks.find(t => t.id.startsWith('real-2-'));  // priority 1 in fixture
    expect(highPriorityTask!.priority).toBe(3);
    expect(lowPriorityTask!.priority).toBe(1);
  });

  it('converts fractional-day start/end times into ticks using ticksPerDay', async () => {
    const tasks = await loadRealWorkload({ dbPath, ticksPerDay: 100 });
    // vmId 3: starttime=1.0 day, endtime=3.0 day -> arrival=100, duration=200
    const t3 = tasks.find(t => t.id.startsWith('real-3-'));
    expect(t3!.arrivalTime).toBe(100);
    expect(t3!.duration).toBe(200);
  });

  it('respects maxTasks to keep the sample small', async () => {
    const tasks = await loadRealWorkload({ dbPath, maxTasks: 1 });
    expect(tasks.length).toBe(1);
  });
});
