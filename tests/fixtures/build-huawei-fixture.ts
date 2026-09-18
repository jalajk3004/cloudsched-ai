import * as fs from 'fs';

/** Builds a tiny CSV file matching the exact Huawei-East-1 event-log
 *  schema (vmid,cpu,memory,time,type), so we can test the adapter
 *  without needing the real ~125,000-row file. */
export function buildHuaweiFixtureCsv(path: string): void {
  const rows = [
    'vmid,cpu,memory,time,type',
    '1,2,4,100,0',    // vm1 created at t=100 with 2 cpu, 4GB
    '1,2,4,400,1',    // vm1 deleted at t=400 -> duration 300s
    '2,1,2,150,0',    // vm2 created at t=150
    '2,1,2,600,1',    // vm2 deleted at t=600 -> duration 450s
    '3,4,8,200,0',    // vm3 created, NEVER deleted -> must be dropped
    '4,1,1,500,1',    // vm4 deleted but NEVER created -> must be dropped
  ];
  fs.writeFileSync(path, rows.join('\n'));
}

if (require.main === module) {
  const path = process.argv[2] || '/tmp/huawei-fixture.csv';
  buildHuaweiFixtureCsv(path);
  console.log(`Fixture CSV written to ${path}`);
}
