# Team Division of Work

This project is split so each of the 3 members has clearly separated,
individually-gradable work, while everyone builds on the same shared
foundation. Nobody duplicates the simulation, scheduling, or metrics
logic — that already exists and is shared. The only thing split three
ways is **which LLM powers the AI scheduler**.

## Shared code (already built, do not duplicate)

Everyone uses this as-is. It does not belong to any one member and
should not be copied or reimplemented:

- `src/domain/types.ts` — Task, Server, Scheduler interface
- `src/engine/simulation-engine.ts` — the tick loop and resource checks
- `src/schedulers/*.ts` — First-Fit, Best-Fit, Round-Robin baselines
- `src/workload/generator.ts` — seeded workload generator
- `src/metrics/metrics-engine.ts` — the shared metrics formulas
- `src/ai-scheduler/llm-provider.ts` — the interface every model plugs into
- `src/ai-scheduler/policy-validator.ts` — schema/range validation
- `src/ai-scheduler/policy-interpreter.ts` — turns a policy into scheduling decisions
- `src/ai-scheduler/search-loop.ts` — the generate-test-evaluate-improve loop

## Individual work — one LLM provider per member

Each member implements **exactly one file**, following the `LLMProvider`
interface in `src/ai-scheduler/llm-provider.ts`. This is the only file
you need to touch for your part of the AI scheduler.

| Member | File to implement | Model |
|---|---|---|
| Member 1 | `src/ai-scheduler/providers/groq-provider.ts` | Groq (e.g. Llama 3.3 via Groq API) |
| Member 2 | `src/ai-scheduler/providers/gemini-provider.ts` | Google Gemini |
| Member 3 | `src/ai-scheduler/providers/claude-provider.ts` | Anthropic Claude |

Each provider file already has a `TODO` comment at the top with the
exact steps to follow. The only job of your file is: **take the
context object, talk to your model, return a `PolicyProposal` object**.
You do not need to (and should not) touch validation, the simulator, or
the scoring logic — that's shared and already handles whatever your
provider returns.

## How to test your own provider in isolation

You do not need anyone else's provider finished to test your own. Run:

```bash
npx ts-node src/experiment/run-ai-search-cli.ts groq      # Member 1
npx ts-node src/experiment/run-ai-search-cli.ts gemini    # Member 2
npx ts-node src/experiment/run-ai-search-cli.ts claude    # Member 3
```

(This CLI script is provided — see `src/experiment/run-ai-search-cli.ts`.)

## Why it's split this way

- Each member's grade/contribution is isolated to one file — easy for
  the professor to see who did what.
- Because everyone implements the same `LLMProvider` interface, all
  three can be swapped into the exact same `AiScheduler` /
  `runSearchLoop` without any of the shared code changing — this is
  the same "one shared interface, pluggable implementations" pattern
  already used for First-Fit / Best-Fit / Round-Robin.
- As a side effect, once all three are done, the project can directly
  compare Groq vs. Gemini vs. Claude as AI schedulers, not just
  "AI vs. classical" — a natural extension noted in the methodology
  document's "What We Could Improve Later" section.

## Rules for individual work

- Only edit your own provider file. If you think shared code needs to
  change, raise it with the group first — a change there affects
  everyone's results.
- Never commit API keys. Use a local `.env` file (already gitignored)
  and read it with `process.env.YOUR_KEY_NAME`.
- Do not change `ALLOWED_POLICY_FEATURES` in `llm-provider.ts` on your
  own — if your model needs a feature the others don't have, that's a
  group decision, since it changes what "fair comparison" means for
  everyone.
