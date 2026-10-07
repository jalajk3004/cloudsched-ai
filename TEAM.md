# Project Architecture & AI Model

This project compares classical heuristics (First-Fit, Best-Fit, and Round-Robin) against an AI-driven scheduler on both synthetic and real cloud workload data.

The AI scheduler is powered by **Qwen3 (e.g. `qwen3:4b`)**, run locally via **Ollama**.

## Architecture

- `src/domain/types.ts` — Task, Server, Scheduler interface
- `src/engine/simulation-engine.ts` — the tick loop and resource checks
- `src/schedulers/*.ts` — First-Fit, Best-Fit, Round-Robin baselines
- `src/workload/generator.ts` — seeded workload generator
- `src/metrics/metrics-engine.ts` — the shared metrics formulas
- `src/ai-scheduler/llm-provider.ts` — LLMProvider interface
- `src/ai-scheduler/providers/qwen-provider.ts` — Qwen3 provider implementation using Ollama
- `src/ai-scheduler/policy-validator.ts` — schema and range validation
- `src/ai-scheduler/policy-interpreter.ts` — turns policy proposals into scheduling decisions
- `src/ai-scheduler/search-loop.ts` — generate-test-evaluate-improve search loop

## Local Setup for Qwen (Ollama)

The Qwen provider runs locally and requires no API key:
1. Install Ollama from https://ollama.com
2. Pull the model:
   ```bash
   ollama pull qwen3:4b
   ```
3. Test the model:
   ```bash
   ollama run qwen3:4b
   ```
   (type `/bye` to exit)

By default, the provider communicates with Ollama at `http://localhost:11434`.

## Running the Search Loop and Comparison

```bash
# Run AI search loop with Qwen
npx ts-node src/experiment/run-ai-search-cli.ts qwen cpu-heavy

# Run full comparison against baselines
npx ts-node src/experiment/run-full-comparison-cli.ts qwen cpu-heavy 5
```