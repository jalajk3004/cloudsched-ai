# Testing the Baseline Schedulers (No AI Involved)

This covers ONLY First-Fit, Best-Fit, and Round-Robin, against all three
data sources: the synthetic workload generator, the real Azure dataset,
and the real Huawei dataset. The AI scheduler is not touched anywhere
here. This assumes you already have your real data files at:

```
data/azure.sqlite
data/huawei-east.csv
```

If your files are named or placed differently, just swap the path in
every command below.

---

## 0. One-time setup

```bash
npm install
npx tsc --noEmit -p tsconfig.json   # should print nothing
npx jest                            # should say "Tests: 41 passed, 41 total"
```

Do not continue past this step until `npx jest` shows all tests passing.
Everything below depends on the shared engine/schedulers/metrics/
persistence code already being known-good.

---

## Part A — Run the baselines against all three data sources

### A1. Synthetic workload generator (Option B)

```bash
npx ts-node src/experiment/run-baseline-cli.ts balanced
npx ts-node src/experiment/run-baseline-cli.ts cpu-heavy
npx ts-node src/experiment/run-baseline-cli.ts mem-heavy
npx ts-node src/experiment/run-baseline-cli.ts burst
npx ts-node src/experiment/run-baseline-cli.ts mixed
```

### A2. Azure Trace for Packing 2020 (real data)

```bash
npx ts-node src/experiment/run-real-data-cli.ts data/azure.sqlite 500
```

### A3. Huawei-East-1 (real data, same dataset MiCo's paper uses)

```bash
npx ts-node src/experiment/run-huawei-data-cli.ts data/huawei-east.csv 500
```

Every one of the commands above prints a results table AND records the
exact workload it used into a local database (see Part B) - nothing
extra to do for that, it happens automatically.

---

## Part B — The maintained workload database

Every time you run any of the three commands in Part A, the exact tasks
that were generated or loaded get written to `data/workload-history.sqlite`.
This is a real, inspectable record of what data every scheduler was
actually tested against - not just the printed summary table.

### B1. See everything that's been recorded so far

```bash
npx ts-node src/experiment/view-workload-history.ts
```

Prints one row per run: id, source (synthetic/azure/huawei), label
(scenario name or file path), task count, average CPU/memory/duration,
and when it was recorded.

### B2. Inspect the actual tasks from one specific run

```bash
npx ts-node src/experiment/view-workload-history.ts <id>
```
Replace `<id>` with a number from the B1 listing. Shows the first 10
real tasks from that exact run, with all their fields.

---

## Part C — Proving the baselines are actually correct (not just "it ran")

A results table printing numbers is not proof of correctness by itself -
here's how to actually verify it, and how to explain that verification
to your teacher.

### C1. Run the automated invariant checker

This runs all three baselines against real data and checks two things
that must be true no matter what data is used:

```bash
npx ts-node src/experiment/verify-invariants.ts synthetic cpu-heavy
npx ts-node src/experiment/verify-invariants.ts azure data/azure.sqlite
npx ts-node src/experiment/verify-invariants.ts huawei data/huawei-east.csv
```

It checks, for every scheduler:
1. **No server is ever given more work than its real capacity** - proves
   the engine's resource-checking logic actually holds under real data,
   not just in a hand-written test case.
2. **Every task is accounted for** - `scheduled count + rejected count`
   must exactly equal the total number of tasks. If this doesn't hold,
   tasks are silently disappearing somewhere, which would be a real bug.

### C2. What to tell your teacher, in plain terms

Say this, roughly:

> "Correctness here means two things: the scheduler never assigns a task
> to a server that doesn't actually have room for it, and no task is
> ever lost or double-counted. We don't just trust the printed numbers -
> we run an automated check after every simulation that re-examines the
> server state at every single time step and confirms neither of these
> things ever happened, on real production data from Azure and Huawei,
> not just made-up examples."

### C3. Two more checks worth mentioning if asked for more rigor

- **Unit tests (`npx jest`)** prove each scheduler's *algorithm* is
  correct in isolation - e.g. there's a test that hands First-Fit a
  server with no room and confirms it correctly refuses to place the
  task there, and a test that deliberately tries to trick the engine
  into over-booking a server and confirms the engine refuses.
- **Determinism** - run the exact same command twice:
  ```bash
  npx ts-node src/experiment/run-baseline-cli.ts cpu-heavy
  npx ts-node src/experiment/run-baseline-cli.ts cpu-heavy
  ```
  The numbers will be identical both times. This is a very visual way to
  show a professor the results aren't random noise - the same seed
  always produces the same workload and the same outcome.

---

## Full checklist before considering the baseline stage complete

- [ ] `npx jest` → 41 passed, 41 total
- [ ] All 5 synthetic scenarios (A1) run and print sane numbers
- [ ] Azure baselines run successfully on the real file (A2)
- [ ] Huawei baselines run successfully on the real file (A3)
- [ ] `view-workload-history.ts` shows all your runs recorded (B1)
- [ ] `verify-invariants.ts` prints ✅ PASS for all three schedulers on all three sources (C1)

---

## Quick command reference

| Task | Command |
|---|---|
| Run tests | `npx jest` |
| Synthetic baseline | `npx ts-node src/experiment/run-baseline-cli.ts <scenario>` |
| Azure baseline | `npx ts-node src/experiment/run-real-data-cli.ts data/azure.sqlite [maxTasks]` |
| Huawei baseline | `npx ts-node src/experiment/run-huawei-data-cli.ts data/huawei-east.csv [maxTasks]` |
| View recorded workload history | `npx ts-node src/experiment/view-workload-history.ts` |
| View one specific recorded run | `npx ts-node src/experiment/view-workload-history.ts <id>` |
| Verify correctness invariants | `npx ts-node src/experiment/verify-invariants.ts <synthetic\|azure\|huawei> <scenario-or-path>` |

Available synthetic scenarios: `balanced`, `cpu-heavy`, `mem-heavy`,
`burst`, `mixed`.
