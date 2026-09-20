# CloudSched-AI

A research platform comparing First-Fit, Best-Fit, and Round-Robin against
an AI-driven scheduler, on both synthetic and real cloud workload data.

This README is the single source of truth for **running the project
locally**. Follow it top to bottom the first time; after that, jump to
whichever section you need.

---

## 0. Prerequisites

- Node.js 18 or newer (`node -v` to check)
- npm (comes with Node)
- No paid API keys needed yet - the AI scheduler stage is still stubbed

---

## 1. Install and verify (do this first, every time you pull new code)

```bash
npm install
npx tsc --noEmit -p tsconfig.json   # should print nothing = success
npx jest                            # should say "Tests: 35 passed, 35 total"
```

If either of those fails, stop and fix it before continuing - everything
below assumes both pass clean.

---

## 2. Run the baselines on SYNTHETIC data (Option B - already working)

No download needed. This generates tasks with a seeded random generator.

```bash
npx ts-node src/experiment/run-baseline-cli.ts balanced
npx ts-node src/experiment/run-baseline-cli.ts cpu-heavy
npx ts-node src/experiment/run-baseline-cli.ts mem-heavy
npx ts-node src/experiment/run-baseline-cli.ts burst
npx ts-node src/experiment/run-baseline-cli.ts mixed
```

Each prints a table comparing First-Fit / Best-Fit / Round-Robin (5
repeated runs, averaged) on that workload scenario.

---

## 3. Run the baselines on REAL data (Option A)

Two real datasets are supported. Both need to be downloaded manually first
- they are not included in this repo (see `.gitignore`).

### 3a. Azure Trace for Packing (2020)

**Download:**
```
https://github.com/Azure/AzurePublicDataset/releases/download/dataset-packing-2020/azurevmallocation_dataset2020_AzurePackingTraceV1.zip
```
Unzip it - you'll get a `.sqlite`/`.db` file with two tables, `VM Requests`
and `VM Types`.

**Run:**
```bash
npx ts-node src/experiment/run-real-data-cli.ts data/azure.sqlite 500 
```
The `500` limits how many tasks are loaded - raise it once it works.

### 3b. Huawei-East-1 (the same dataset MiCo's paper uses)

**Download:** documented at `huaweicloud/vm-placement-dataset` on GitHub,
but the actual CSV file is bundled inside `mail-ecnu/VMAgent`'s repo
(look for a `data/` folder there). Check both if one doesn't have it.

**Run:**
```bash
npx ts-node src/experiment/run-huawei-data-cli.ts data/huawei-east.csv 500
```



### Sanity-check the adapters without any real file

Both adapters have a fixture builder that creates a tiny fake file with
the exact same schema, so you can prove the pipeline works before you
even have the real data:

```bash
npx ts-node tests/fixtures/build-fixture-db.ts /tmp/demo.db
npx ts-node src/experiment/run-real-data-cli.ts /tmp/demo.db

npx ts-node tests/fixtures/build-huawei-fixture.ts /tmp/demo.csv
npx ts-node src/experiment/run-huawei-data-cli.ts /tmp/demo.csv
```

---



## 4. Moving on to the AI scheduler (Phase 4)

The AI-scheduler scaffolding is already built and tested - it just has no
real LLM wired in yet. See **`TEAM.md`** for exactly who implements which
model. In short:

```bash
npx ts-node src/experiment/run-ai-search-cli.ts groq cpu-heavy
```
Right now this correctly fails with "Not implemented yet" - that's
expected. Once a member fills in their provider file
(`src/ai-scheduler/providers/<name>-provider.ts`), this same command
will actually run the generate-test-evaluate-improve search loop.

---

## 6. Project structure, quick reference

```
src/
  domain/           Task, Server, Scheduler interface - shared types
  engine/           the tick-loop simulation engine
  schedulers/       First-Fit, Best-Fit, Round-Robin
  workload/         synthetic generator + real-data adapters (Azure, Huawei)
  metrics/          the shared metrics formulas
  ai-scheduler/     LLM provider interface, validator, policy interpreter,
                     search loop, and the three provider stubs
  experiment/       CLI entry points (this is what you actually run)
tests/              one test file per shared module, plus fixtures/
TEAM.md             who implements which LLM provider
```

## 7. Common issues

| Symptom | Fix |
|---|---|
| `npx jest` fails right after `git pull` | run `npm install` again - a dependency probably changed |
| A CLI script errors with a TypeScript error | run `npx tsc --noEmit -p tsconfig.json` first to see the real error clearly |
| Real-data CLI says "No valid tasks were loaded" | the file path is wrong, or the downloaded file doesn't match the documented schema - paste the error, don't guess |

# to test on each server wrokload
```sh
npx ts-node src/experiment/compare-server-configs.ts synthetic cpu-heavy 500
```