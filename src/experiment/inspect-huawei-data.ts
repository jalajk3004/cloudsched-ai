import { loadHuaweiWorkload } from '../workload/huawei-data-adapter';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: ts-node inspect-huawei-data.ts <path-to-csv> [maxTasks]');
  process.exit(1);
}
const maxTasks = process.argv[3] ? parseInt(process.argv[3], 10) : 2000;

const tasks = loadHuaweiWorkload({ csvPath, maxTasks });
console.log(`Loaded ${tasks.length} tasks\n`);

if (tasks.length === 0) {
  console.error('Nothing loaded - something is wrong with parsing.');
  process.exit(1);
}

// Huawei's own published stat: "more than 2/3 of requests use only 1 CPU
// core and less than 2GB memory" - this is the real sanity check.
const smallCount = tasks.filter(t => t.cpuRequired <= 1 && t.memRequired < 2048).length;
const smallPct = (smallCount / tasks.length) * 100;

const cpuValues = tasks.map(t => t.cpuRequired);
const memValues = tasks.map(t => t.memRequired);
const durationValues = tasks.map(t => t.duration);
const arrivalValues = tasks.map(t => t.arrivalTime);

const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
const min = (arr: number[]) => Math.min(...arr);
const max = (arr: number[]) => Math.max(...arr);

console.log(`CPU cores      -> min ${min(cpuValues)}, avg ${avg(cpuValues).toFixed(2)}, max ${max(cpuValues)}`);
console.log(`Memory (MB)    -> min ${min(memValues)}, avg ${avg(memValues).toFixed(0)}, max ${max(memValues)}`);
console.log(`Duration       -> min ${min(durationValues)}, avg ${avg(durationValues).toFixed(1)}, max ${max(durationValues)}`);
console.log(`Arrival tick   -> min ${min(arrivalValues)}, max ${max(arrivalValues)}`);
console.log();
console.log(`Tasks that are "small" (<=1 CPU, <2GB mem): ${smallCount} of ${tasks.length} = ${smallPct.toFixed(1)}%`);
console.log(`Huawei's own docs claim this should be > 66% ("more than 2/3"). ${smallPct > 66 ? '✅ MATCHES' : '⚠️  DOES NOT MATCH - investigate'}`);
