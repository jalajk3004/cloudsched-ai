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

  it('computes duration as (deletion time - creation time), scaled by ticksPerSecond', () => {
    const tasks = loadHuaweiWorkload({ csvPath, ticksPerSecond: 1 }); // 1:1 for easy math
    const vm1 = tasks.find(t => t.id === 'huawei-1')!;
    expect(vm1.arrivalTime).toBe(100);
    expect(vm1.duration).toBe(300); // 400 - 100
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
