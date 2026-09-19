import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildHuaweiFixtureCsv } from '../fixtures/build-huawei-fixture';
import { loadHuaweiWorkload } from '../../src/workload/huawei-data-adapter';

describe('loadHuaweiWorkload (Huawei-East-1 adapter)', () => {
  let csvPath: string;

  beforeAll(() => {
    csvPath = path.join(os.tmpdir(), `huawei-fixture-${Date.now()}.csv`);
    buildHuaweiFixtureCsv(csvPath);
  });

  afterAll(() => {
    fs.unlinkSync(csvPath);
  });

  it('only returns VMs with a matched creation AND deletion event', () => {
    const tasks = loadHuaweiWorkload({ csvPath });
    // fixture has 4 vmids total (1,2,3,4), only 1 and 2 have both events
    expect(tasks.length).toBe(2);
    expect(tasks.map(t => t.id).sort()).toEqual(['huawei-1', 'huawei-2']);
  });

  it('computes arrivalTime as an OFFSET from the earliest event, and duration correctly', () => {
    const tasks = loadHuaweiWorkload({ csvPath, ticksPerSecond: 1 }); // 1:1 for easy math
    // vm1 (creation.time=100) is the earliest creation in the fixture, so its
    // arrival is offset to 0 - this is the fix: absolute time values (which
    // could be huge, e.g. Unix timestamps) never leak into tick numbers directly.
    const vm1 = tasks.find(t => t.id === 'huawei-1')!;
    expect(vm1.arrivalTime).toBe(0); // 100 - minTime(100)
    expect(vm1.duration).toBe(300);  // 400 - 100, duration is unaffected by the offset

    const vm2 = tasks.find(t => t.id === 'huawei-2')!;
    expect(vm2.arrivalTime).toBe(50); // 150 - minTime(100)
  });

  it('auto-scales the time conversion so a wide time range never produces a runaway tick count', () => {
    const tasks = loadHuaweiWorkload({ csvPath, targetTickSpan: 200 });
    // observed span in the fixture is (600 - 100) = 500 seconds -> ticksPerSecond = 200/500 = 0.4
    const vm1 = tasks.find(t => t.id === 'huawei-1')!;
    const vm2 = tasks.find(t => t.id === 'huawei-2')!;
    expect(Math.max(vm1.arrivalTime + vm1.duration, vm2.arrivalTime + vm2.duration)).toBeLessThanOrEqual(200);
  });

  it('converts memory from GB to MB', () => {
    const tasks = loadHuaweiWorkload({ csvPath, memoryGbToMb: 1024 });
    const vm1 = tasks.find(t => t.id === 'huawei-1')!;
    expect(vm1.memRequired).toBe(4 * 1024);
  });

  it('uses the creation event cpu value directly (already in cores)', () => {
    const tasks = loadHuaweiWorkload({ csvPath });
    const vm2 = tasks.find(t => t.id === 'huawei-2')!;
    expect(vm2.cpuRequired).toBe(1);
  });

  it('respects maxTasks', () => {
    const tasks = loadHuaweiWorkload({ csvPath, maxTasks: 1 });
    expect(tasks.length).toBe(1);
  });
});