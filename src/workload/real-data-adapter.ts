import * as fs from 'fs';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { Task, Priority } from '../domain/types';

export interface RealDataConfig {
  dbPath: string;
  maxTasks?: number;          // take only the first N valid rows (keep the sample small)
  ticksPerDay?: number;       // how many simulation ticks represent 1 real day
  cpuUnitsPerMachine?: number; // how many "our CPU units" = 1 full machine's core allocation
  memUnitsPerMachine?: number; // how many "our MB units" = 1 full machine's memory allocation
}

const DEFAULTS = {
  maxTasks: 2000,
  ticksPerDay: 100,        // 1 day of real trace = 100 simulation ticks
  cpuUnitsPerMachine: 8,   // a "full machine" of CPU = 8 of our CPU units
  memUnitsPerMachine: 8192, // a "full machine" of memory = 8192 MB
};

/**
 * Reads the Azure Trace for Packing 2020 SQLite file and converts it into
 * our Task[] format. This is Option A (real historical data), used
 * alongside Option B (synthetic generator.ts) - never as a replacement.
 *
 * Schema reference (from Azure/AzurePublicDataset's
 * AzureTracesForPacking2020.md):
 *   VM Requests: vmId, tenantId, vmTypeId, priority, starttime, endtime
 *   VM Types:    id, vmTypeId, machineId, core, memory, hdd, ssd, nic
 *
 * Real-world quirks this function deliberately handles:
 *  - `starttime` can be NEGATIVE (a VM that was already running before
 *    the 14-day collection window began). We drop these - we have no
 *    real arrival time for them.
 *  - `endtime` can be NULL (a VM still alive when the trace was
 *    collected). We drop these - we have no real duration for them.
 *  - `core`/`memory` are FRACTIONAL MACHINE UNITS (e.g. 0.5 = half a
 *    machine), not our absolute CPU/MB units - we scale them using
 *    cpuUnitsPerMachine/memUnitsPerMachine.
 *  - priority in the source data only has 2 levels (0=high, 1=low), not
 *    our 3 (low/medium/high) - we map 0 -> 3 (high) and 1 -> 1 (low).
 */
export async function loadRealWorkload(config: RealDataConfig): Promise<Task[]> {
  const opts = { ...DEFAULTS, ...config };
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(opts.dbPath);
  const db: SqlJsDatabase = new SQL.Database(fileBuffer);

  try {
    const stmt = db.prepare(`
      SELECT r.vmId as vmId, r.priority as priority, r.starttime as starttime, r.endtime as endtime,
             t.core as core, t.memory as memory
      FROM "VM Requests" r
      JOIN "VM Types" t ON r.vmTypeId = t.vmTypeId
      WHERE r.starttime >= 0 AND r.endtime IS NOT NULL
      ORDER BY r.starttime ASC
      LIMIT :maxTasks
    `);
    stmt.bind({ ':maxTasks': opts.maxTasks });

    const rows: Array<{ vmId: number; priority: number; starttime: number; endtime: number; core: number; memory: number }> = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      rows.push({ vmId: row.vmId, priority: row.priority, starttime: row.starttime, endtime: row.endtime, core: row.core, memory: row.memory });
    }
    stmt.free();

    return rows.map((row, i) => rowToTask(row, i, opts));
  } finally {
    db.close();
  }
}

function rowToTask(
  row: { vmId: number; priority: number; starttime: number; endtime: number; core: number; memory: number },
  index: number,
  opts: Required<RealDataConfig>,
): Task {
  const cpuRequired = Math.max(1, Math.round(row.core * opts.cpuUnitsPerMachine));
  const memRequired = Math.max(1, Math.round(row.memory * opts.memUnitsPerMachine));
  const arrivalTime = Math.round(row.starttime * opts.ticksPerDay);
  const durationDays = row.endtime - row.starttime;
  const duration = Math.max(1, Math.round(durationDays * opts.ticksPerDay));
  const priority: Priority = row.priority === 0 ? 3 : 1; // 0=high->3, 1=low->1 (no source "medium")

  return {
    id: `real-${row.vmId}-${index}`,
    cpuRequired,
    memRequired,
    duration,
    arrivalTime,
    priority,
    status: 'pending',
  };
}
