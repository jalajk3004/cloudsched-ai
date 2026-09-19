import * as fs from 'fs';
import { Task, Priority } from '../domain/types';

export interface HuaweiDataConfig {
  csvPath: string;
  maxTasks?: number;
  ticksPerSecond?: number;   // explicit override; if omitted, auto-derived (see below)
  targetTickSpan?: number;   // when ticksPerSecond is omitted, compress the observed
  // time range into roughly this many simulation ticks
  memoryGbToMb?: number;     // conversion factor, normally 1024
}

const DEFAULTS = {
  maxTasks: 2000,
  targetTickSpan: 1000,
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
 *  - The `time` column's exact units/reference point aren't verified
 *    against the real file (could be seconds since collection start, or
 *    something else entirely). Rather than assume a fixed conversion
 *    factor - which previously caused simulations to blow up to millions
 *    of ticks once enough rows were pulled in - this function AUTO-SCALES:
 *    it looks at the actual observed time range in the loaded sample and
 *    compresses it into roughly `targetTickSpan` simulation ticks,
 *    regardless of how many rows are loaded or what the raw units turn
 *    out to be. Pass an explicit `ticksPerSecond` to override this.
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

  // Collect valid (creation + matching deletion) pairs first, capped at
  // maxTasks, BEFORE deciding the time scale - so the scale is derived
  // from exactly the sample we're actually going to use.
  const pairs: { vmid: string; creation: RawEvent; deletion: RawEvent }[] = [];
  for (const [vmid, creation] of creations) {
    const deletion = deletions.get(vmid);
    if (!deletion) continue; // still running at end of trace -> unknown duration, drop
    if (deletion.time <= creation.time) continue; // malformed ordering, drop defensively
    pairs.push({ vmid, creation, deletion });
    if (pairs.length >= opts.maxTasks) break;
  }

  if (pairs.length === 0) return [];

  // Derive (or use the caller-supplied) time scale from the OBSERVED
  // range of this exact sample - this is what prevents a huge sample
  // from ever producing a runaway tick count, no matter what the raw
  // `time` units actually are.
  const minTime = Math.min(...pairs.map(p => p.creation.time));
  const maxTime = Math.max(...pairs.map(p => p.deletion.time));
  const observedSpan = Math.max(1, maxTime - minTime);
  const ticksPerSecond = opts.ticksPerSecond ?? (opts.targetTickSpan / observedSpan);

  const tasks: Task[] = pairs.map(({ vmid, creation, deletion }) => ({
    id: `huawei-${vmid}`,
    cpuRequired: Math.max(1, Math.round(creation.cpu)),
    memRequired: Math.max(1, Math.round(creation.memory * opts.memoryGbToMb)),
    duration: Math.max(1, Math.round((deletion.time - creation.time) * ticksPerSecond)),
    // offset by minTime so ticks always start near 0, regardless of
    // whether the raw `time` values are small relative numbers or large
    // absolute ones (e.g. Unix timestamps)
    arrivalTime: Math.max(0, Math.round((creation.time - minTime) * ticksPerSecond)),
    priority: 2 as Priority, // dataset has no priority field
    status: 'pending',
  }));

  return tasks.sort((a, b) => a.arrivalTime - b.arrivalTime);
}