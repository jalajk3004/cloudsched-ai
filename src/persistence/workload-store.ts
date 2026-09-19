import * as fs from 'fs';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { Task } from '../domain/types';

export type WorkloadSource = 'synthetic' | 'azure' | 'huawei';

export interface WorkloadRunSummary {
  id: number;
  source: WorkloadSource;
  label: string;        // scenario name (synthetic) or file path (real data)
  taskCount: number;
  avgCpu: number;
  avgMem: number;
  avgDuration: number;
  minArrival: number;
  maxArrival: number;
  createdAt: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workload_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    label TEXT NOT NULL,
    task_count INTEGER NOT NULL,
    avg_cpu REAL NOT NULL,
    avg_mem REAL NOT NULL,
    avg_duration REAL NOT NULL,
    min_arrival INTEGER NOT NULL,
    max_arrival INTEGER NOT NULL,
    config_json TEXT,
    tasks_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

async function openOrCreate(dbPath: string): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    return new SQL.Database(fs.readFileSync(dbPath));
  }
  const db = new SQL.Database();
  db.run(SCHEMA);
  return db;
}

function persist(db: SqlJsDatabase, dbPath: string): void {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

/**
 * Records exactly what tasks were generated/loaded for one run, so there
 * is always a maintained, inspectable record of what data the schedulers
 * were actually tested against - not just the printed console summary.
 */
export async function recordWorkloadRun(
  dbPath: string,
  source: WorkloadSource,
  label: string,
  tasks: Task[],
  config: unknown,
): Promise<number> {
  const db = await openOrCreate(dbPath);
  db.run(SCHEMA); // no-op if it already exists

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const cpuValues = tasks.map(t => t.cpuRequired);
  const memValues = tasks.map(t => t.memRequired);
  const durationValues = tasks.map(t => t.duration);
  const arrivalValues = tasks.map(t => t.arrivalTime);

  const stmt = db.prepare(`
    INSERT INTO workload_runs
      (source, label, task_count, avg_cpu, avg_mem, avg_duration, min_arrival, max_arrival, config_json, tasks_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([
    source,
    label,
    tasks.length,
    avg(cpuValues),
    avg(memValues),
    avg(durationValues),
    tasks.length ? Math.min(...arrivalValues) : 0,
    tasks.length ? Math.max(...arrivalValues) : 0,
    JSON.stringify(config ?? null),
    JSON.stringify(tasks),
    new Date().toISOString(),
  ]);
  stmt.free();

  // IMPORTANT: read last_insert_rowid() BEFORE persist()/export() - doing
  // it after was observed to return a stale/zero value.
  const idResult = db.exec('SELECT last_insert_rowid() as id');
  const id = idResult[0].values[0][0] as number;

  persist(db, dbPath);
  db.close();
  return id;
}

/** Lists every recorded run, newest first, WITHOUT the full task list
 *  (keep it light for a summary view). */
export async function listWorkloadRuns(dbPath: string): Promise<WorkloadRunSummary[]> {
  if (!fs.existsSync(dbPath)) return [];
  const db = await openOrCreate(dbPath);

  const stmt = db.prepare(`
    SELECT id, source, label, task_count, avg_cpu, avg_mem, avg_duration, min_arrival, max_arrival, created_at
    FROM workload_runs ORDER BY id DESC
  `);
  const rows: WorkloadRunSummary[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as any;
    rows.push({
      id: r.id, source: r.source, label: r.label, taskCount: r.task_count,
      avgCpu: r.avg_cpu, avgMem: r.avg_mem, avgDuration: r.avg_duration,
      minArrival: r.min_arrival, maxArrival: r.max_arrival, createdAt: r.created_at,
    });
  }
  stmt.free();
  db.close();
  return rows;
}

/** Retrieves the full task list for one specific recorded run, for
 *  detailed inspection or exact reproduction later. */
export async function getWorkloadRunTasks(dbPath: string, id: number): Promise<Task[] | null> {
  if (!fs.existsSync(dbPath)) return null;
  const db = await openOrCreate(dbPath);

  const stmt = db.prepare(`SELECT tasks_json FROM workload_runs WHERE id = ?`);
  stmt.bind([id]);
  let tasks: Task[] | null = null;
  if (stmt.step()) {
    const row = stmt.getAsObject() as any;
    tasks = JSON.parse(row.tasks_json);
  }
  stmt.free();
  db.close();
  return tasks;
}
