# Member 1 Setup Guide — Implementing the Groq AI Scheduler

This guide assumes you know very little about the project yet. Follow
every step in order — don't skip ahead.

## What you're building

You're implementing one file: `src/ai-scheduler/providers/groq-provider.ts`.
This file's only job is to talk to Groq's AI service, ask it for a
scheduling strategy, and hand that strategy back to the rest of the
system. You do not need to touch or understand the simulation engine,
the schedulers, or the metrics — those are already built and shared by
the whole team.

---

## Step 1 — Get the code onto your machine

Ask your team lead for the repository URL, then run:

```bash
git clone <the-repo-url-your-team-lead-gives-you>
cd cloudsched-ai
```

## Step 2 — Create your own branch

Never work directly on `main`. Create a branch just for your work:

```bash
git checkout -b member1-groq-integration
```

## Step 3 — Install dependencies

```bash
npm install
```

## Step 4 — Confirm the project already works, before you change anything

```bash
npx jest
```
This should print `Tests: 50 passed, 50 total`. If it doesn't, stop and
ask your team lead before continuing — something is wrong with the base
project, not your part.

## Step 5 — Get a free Groq API key

1. Go to `console.groq.com`
2. Sign up (free)
3. Create an API key, copy it somewhere safe

## Step 6 — Set up your local environment file

```bash
cp .env.example .env
```
Open `.env` in a text editor. Find the line `GROQ_API_KEY=` and paste
your key right after the `=`, no quotes, no spaces:
```
GROQ_API_KEY=gsk_your_actual_key_here
```
**Never commit this file.** It's already listed in `.gitignore`, so
`git` will ignore it automatically — but double check by running
`git status` and confirming `.env` doesn't show up as a file to be
committed.

## Step 7 — The file you need to create/edit

The file `src/ai-scheduler/providers/groq-provider.ts` needs to contain
exactly this. If it already exists in your checkout with a "TODO, not
implemented yet" message inside it, open it and replace the ENTIRE file
content with this:

```ts
import Groq from 'groq-sdk';
import { LLMProvider, PolicyPromptContext, PolicyProposal, ALLOWED_POLICY_FEATURES } from '../llm-provider';

/**
 * ============================================================
 *  OWNER: Member 1
 *  MODEL: Groq (llama-3.3-70b-versatile)
 * ============================================================
 *
 * This talks to Groq and returns whatever JSON it produces, parsed into
 * a PolicyProposal shape. It does NOT validate the result - that's
 * validatePolicySchema()'s job in ../policy-validator.ts, applied
 * uniformly to every provider's output. If Groq returns malformed JSON
 * or a policy with bad values, this file lets that surface as-is; the
 * caller (search-loop.ts) is responsible for rejecting it safely.
 */
export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  private client: Groq;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error('[GroqProvider] No API key found. Set GROQ_API_KEY in your .env file.');
    }
    this.client = new Groq({ apiKey: key });
  }

  async proposePolicy(context: PolicyPromptContext): Promise<PolicyProposal> {
    const prompt = buildPrompt(context);

    const completion = await this.client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error('[GroqProvider] Empty response from Groq.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`[GroqProvider] Groq did not return valid JSON: ${raw.slice(0, 200)}`);
    }

    return parsed as PolicyProposal;
  }
}

const SYSTEM_PROMPT = `You are designing a scheduling policy for a cloud task scheduler.
Your job is to propose a set of WEIGHTS over a fixed list of features. You do not write code
and you do not control anything else - only these weights.

You must respond with ONLY a JSON object in exactly this shape, nothing else:
{
  "policyName": "<a short descriptive name for this attempt>",
  "weights": {
    "<featureName>": <number between -1 and 1>,
    ...
  },
  "rejectIfNoServerFits": true,
  "tieBreak": "lowest_server_index"
}

Rules:
- "weights" keys MUST come only from this allowed list: ${ALLOWED_POLICY_FEATURES.join(', ')}
- You do not need to use every feature - only include the ones you want to weight.
- Every weight value MUST be a number between -1 and 1 (inclusive).
- "tieBreak" MUST be exactly "lowest_server_index" or "highest_server_index".
- Return ONLY the JSON object. No explanation, no markdown, no code fences.`;

function buildPrompt(context: PolicyPromptContext): string {
  const historyText = context.pastAttempts.length === 0
    ? 'This is the first attempt - no history yet.'
    : context.pastAttempts
        .map((a, i) => `Attempt ${i + 1}: policy=${JSON.stringify(a.policy)} -> score=${a.overallScore.toFixed(3)}`)
        .join('\n');

  return `Scenario: ${context.scenario}
Servers available: ${context.serverCountSummary}
Sample workload: ${context.sampleWorkloadSummary}
Allowed features: ${context.allowedFeatures.join(', ')}

Past attempts and their scores (higher score is better):
${historyText}

Propose a new policy. If past attempts exist, try to improve on the best score so far
by adjusting the weights - don't just repeat the same policy.`;
}
```

## Step 8 — Install the one extra package this file needs

```bash
npm install groq-sdk
```

## Step 9 — Confirm it compiles

```bash
npx tsc --noEmit -p tsconfig.json
```
No output = success. If you see red error text, read it carefully — it
tells you exactly which line has a typo.

## Step 10 — Run the tests again

```bash
npx jest
```
Should still say `50 passed, 50 total`.

## Step 11 — Actually run your provider for real

```bash
npx ts-node src/experiment/run-ai-search-cli.ts groq mixed
```
You should see 5 attempts, each showing whether it was valid, its
metrics (CPU%, memory%, wait time, etc.), and at the end, the best
policy found. If you see an error about the API key, double-check Step 6.

## Step 12 — Run the FULL comparison (Groq vs First-Fit vs Best-Fit vs Round-Robin)

```bash
npx ts-node src/experiment/run-full-comparison-cli.ts groq mixed
```
Try the other scenarios too: `balanced`, `cpu-heavy`, `mem-heavy`, `burst`.

## Step 13 — Commit and push your work

```bash
git add src/ai-scheduler/providers/groq-provider.ts package.json package-lock.json
git commit -m "Implement Groq provider for AI scheduler (Member 1)"
git push origin member1-groq-integration
```

## Step 14 — Open a Pull Request

Go to the repository on GitHub, you'll see a prompt to open a Pull
Request from your branch into `main`. Click it, add a short description
("Implements the Groq LLM provider — tested with run-ai-search-cli.ts
and run-full-comparison-cli.ts"), and ask a teammate to review it.

## If something breaks

- **"No API key found"** → check Step 6, make sure `.env` has your real key, no typos in the variable name `GROQ_API_KEY`.
- **TypeScript errors** → re-check you copied Step 7's code exactly, especially the curly braces.
- **`npx jest` fails on tests unrelated to your file** → don't try to fix those yourself, ask your team lead first.
