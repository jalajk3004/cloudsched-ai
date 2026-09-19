import { listWorkloadRuns, getWorkloadRunTasks } from '../persistence/workload-store';

const DB_PATH = process.env.WORKLOAD_DB_PATH || 'data/workload-history.sqlite';

async function main() {
  const runIdArg = process.argv[2];

  if (runIdArg) {
    const id = parseInt(runIdArg, 10);
    const tasks = await getWorkloadRunTasks(DB_PATH, id);
    if (!tasks) {
      console.error(`No recorded run found with id ${id}.`);
      process.exit(1);
    }
    console.log(`Run #${id} — ${tasks.length} tasks. First 10 shown:\n`);
    console.log('id            cpu   mem(MB)  duration  arrival  priority  status');
    for (const t of tasks.slice(0, 10)) {
      console.log(
        `${t.id.padEnd(14)}${String(t.cpuRequired).padEnd(6)}${String(t.memRequired).padEnd(9)}${String(t.duration).padEnd(10)}${String(t.arrivalTime).padEnd(9)}${String(t.priority).padEnd(10)}${t.status}`,
      );
    }
    return;
  }

  const runs = await listWorkloadRuns(DB_PATH);
  if (runs.length === 0) {
    console.log(`No workload runs recorded yet at ${DB_PATH}.`);
    console.log('Run any of the baseline CLIs first - they record automatically.');
    return;
  }

  console.log(`Workload history (${DB_PATH}) — ${runs.length} recorded run(s):\n`);
  console.log('id   source      label                          tasks   avgCPU  avgMem(MB)  avgDur  arrival range   recorded at');
  for (const r of runs) {
    console.log(
      `${String(r.id).padEnd(5)}${r.source.padEnd(12)}${r.label.slice(0, 28).padEnd(31)}${String(r.taskCount).padEnd(8)}` +
      `${r.avgCpu.toFixed(1).padEnd(8)}${r.avgMem.toFixed(0).padEnd(12)}${r.avgDuration.toFixed(1).padEnd(8)}` +
      `${r.minArrival}-${r.maxArrival}`.padEnd(16) + r.createdAt,
    );
  }
  console.log(`\nTo see the actual tasks in one run: npx ts-node src/experiment/view-workload-history.ts <id>`);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
