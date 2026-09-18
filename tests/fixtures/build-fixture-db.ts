import initSqlJs from 'sql.js';
import * as fs from 'fs';

/** Builds a tiny SQLite database with the EXACT schema documented in
 *  Azure/AzurePublicDataset's AzureTracesForPacking2020.md, so we can
 *  test real-data-adapter.ts without needing the real (large) file. */
export async function buildFixtureDb(path: string): Promise<void> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE "VM Requests" (
      vmId INTEGER,
      tenantId INTEGER,
      vmTypeId INTEGER,
      priority INTEGER,
      starttime REAL,
      endtime REAL
    );
    CREATE TABLE "VM Types" (
      id INTEGER,
      vmTypeId INTEGER,
      machineId INTEGER,
      core REAL,
      memory REAL,
      hdd REAL,
      ssd REAL,
      nic REAL
    );
  `);

  const insertType = db.prepare(`INSERT INTO "VM Types" (id, vmTypeId, machineId, core, memory, hdd, ssd, nic) VALUES (?,?,?,?,?,?,?,?)`);
  insertType.run([1, 100, 1, 0.5, 0.25, 0, 0, 0]);   // half-CPU, quarter-mem type
  insertType.run([2, 101, 1, 0.125, 0.5, 0, 0, 0]);  // small-CPU, half-mem type
  insertType.run([3, 102, 1, 1.0, 1.0, 0, 0, 0]);    // full machine type
  insertType.free();

  const insertReq = db.prepare(`INSERT INTO "VM Requests" (vmId, tenantId, vmTypeId, priority, starttime, endtime) VALUES (?,?,?,?,?,?)`);
  insertReq.run([1, 1, 100, 0, 0.0, 0.5]);    // valid, high priority
  insertReq.run([2, 1, 101, 1, 0.2, 1.2]);    // valid, low priority
  insertReq.run([3, 2, 102, 0, 1.0, 3.0]);    // valid, high priority, full machine
  insertReq.run([4, 2, 100, 1, -2.0, 0.5]);   // INVALID: negative starttime -> must be dropped
  insertReq.run([5, 3, 101, 0, 2.0, null]);   // INVALID: null endtime -> must be dropped
  insertReq.free();

  const data = db.export();
  fs.writeFileSync(path, Buffer.from(data));
  db.close();
}

if (require.main === module) {
  const path = process.argv[2] || '/tmp/fixture.db';
  buildFixtureDb(path).then(() => console.log(`Fixture database written to ${path}`));
}
