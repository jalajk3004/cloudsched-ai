import * as fs from 'fs';
import { Task, Priority } from '../domain/types';

export interface HuaweiDataConfig {
  csvPath: string;
  maxTasks?: number;
  ticksPerSecond?: number;   // how many simulation ticks represent 1 real second
  memoryGbToMb?: number;     // conversion factor, normally 1024
}

const DEFAULTS = {
  maxTasks: 2000,
  ticksPerSecond: 0.01,  // 1 tick = 100 real seconds, so a multi-day trace fits a manageable tick range
  memoryGbToMb: 1024,
};

interface RawEvent {
  vmid: string;
  cpu: number;
  memory: number;
  time: number;
  type: 0 | 1; // 0 = creation, 1 = deletion
}

/**
 * Parses the Huawei-East-1 CSV (the same dataset MiCo's paper points to -
 * see its footnote 1: https://github.com/huaweicloud/VM-placement-dataset,
 * with the actual data file bundled in mail-ecnu/VMAgent's repo).
 *
 * This is an EVENT LOG, not one row per task: every VM appears as a
 * "creation" row (type=0) and, if it was later removed, a matching
 * "deletion" row (type=1) with the same vmid. This function pairs them up:
 *   arrivalTime = the creation event's time
 *   duration    = deletion time - creation time
 *
 * Real-world quirks handled here, same spirit as the Azure adapter:
 *  - A vmid with a creation but NO matching deletion event (still running
 *    when the month-long collection ended) is dropped - we have no real
 *    duration for it, same treatment as Azure's NULL endtime.
 *  - A vmid with a deletion but no creation event (already running when
 *    collection started) is dropped - we have no real arrival time for it.
 *  - This dataset has no priority field at all, unlike Azure's - every
 *    task is given priority 2 (medium) since the source data doesn't
 *    distinguish.
 */
export function loadHuaweiWorkload(config: HuaweiDataConfig): Task[] {
  const opts = { ...DEFAULTS, ...config };
  const raw = fs.readFileSync(opts.csvPath, 'utf-8');
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Tolerate an optional header row (e.g. "vmid,cpu,memory,time,type")
  const startIndex = /[a-zA-Z]/.test(lines[0]) ? 1 : 0;

  const creations = new Map<string, RawEvent>();
  const deletions = new Map<string, RawEvent>();

  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i].split(',').map(s => s.trim());
    if (parts.length < 5) continue;
    const event: RawEvent = {
      vmid: parts[0],
      cpu: Number(parts[1]),
      memory: Number(parts[2]),
      time: Number(parts[3]),
      type: Number(parts[4]) === 1 ? 1 : 0,
    };
    if (Number.isNaN(event.cpu) || Number.isNaN(event.memory) || Number.isNaN(event.time)) continue;

    if (event.type === 0) creations.set(event.vmid, event);
    else deletions.set(event.vmid, event);
  }

  const tasks: Task[] = [];
  for (const [vmid, creation] of creations) {
    const deletion = deletions.get(vmid);
    if (!deletion) continue; // still running at end of trace -> unknown duration, drop
    if (deletion.time <= creation.time) continue; // malformed ordering, drop defensively

    const priority: Priority = 2; // dataset has no priority field

    tasks.push({
      id: `huawei-${vmid}`,
      cpuRequired: Math.max(1, Math.round(creation.cpu)),
      memRequired: Math.max(1, Math.round(creation.memory * opts.memoryGbToMb)),
      duration: Math.max(1, Math.round((deletion.time - creation.time) * opts.ticksPerSecond)),
      arrivalTime: Math.round(creation.time * opts.ticksPerSecond),
      priority,
      status: 'pending',
    });

    if (tasks.length >= opts.maxTasks) break;
  }

  return tasks.sort((a, b) => a.arrivalTime - b.arrivalTime);
}
