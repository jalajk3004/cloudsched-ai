import {
  LLMProvider,
  PolicyPromptContext,
  PolicyProposal,
  ALLOWED_POLICY_FEATURES,
  FEATURE_DESCRIPTIONS,
} from '../llm-provider';

export class QwenProvider implements LLMProvider {
  private calls = 0;
  readonly name = 'qwen';

  constructor(
    private host: string =
      process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    private model: string =
      process.env.OLLAMA_MODEL || 'qwen3:4b',
  ) { }

  async proposePolicy(
    context: PolicyPromptContext,
  ): Promise<PolicyProposal> {
    const prompt = buildPrompt(context);
    const seedBase = Number(process.env.QWEN_SEED ?? 42);
    const seed = Number.isFinite(seedBase) ? seedBase + this.calls : 42 + this.calls;
    this.calls += 1;

    const response = await fetch(`${this.host.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(600_000),
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        format: 'json',
        stream: false,
        think: false,
        options: {
          temperature: 0.9,
          seed,
          num_ctx: 8192,
        },
      }),
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `[QwenProvider] HTTP ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    if (!body.trim()) {
      throw new Error('[QwenProvider] Ollama returned an empty response');
    }

    let envelope: {
      message?: { content?: string };
      done?: boolean;
      done_reason?: string;
      error?: string;
    };

    try {
      envelope = JSON.parse(body);
    } catch {
      throw new Error(
        `[QwenProvider] Invalid Ollama response envelope ` +
        `(length=${body.length}): ${body.slice(0, 500)}`,
      );
    }

    if (envelope.error) {
      throw new Error(`[QwenProvider] Ollama error: ${envelope.error}`);
    }

    const raw = envelope.message?.content?.trim();

    if (!raw) {
      throw new Error(
        `[QwenProvider] Missing message.content; ` +
        `done=${envelope.done}, reason=${envelope.done_reason ?? 'unknown'}`,
      );
    }

    try {
      // Do not silently repair invalid model output.
      return JSON.parse(
        raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
      ) as PolicyProposal;
    } catch {
      throw new Error(
        `[QwenProvider] Model returned invalid JSON ` +
        `(length=${raw.length}, done=${envelope.done}, ` +
        `reason=${envelope.done_reason ?? 'unknown'}): ` +
        raw.slice(0, 500),
      );
    }
  }
}

function featureMeanings(): string {
  return ALLOWED_POLICY_FEATURES
    .map(feature => `- ${feature}: ${FEATURE_DESCRIPTIONS[feature]}`)
    .join('\n');
}

const SYSTEM_PROMPT = `
You design new scheduling policies for a deterministic cloud scheduler.

Return exactly one JSON object and no Markdown.

APPROVED FEATURES:
${featureMeanings()}

Use only the approved features above.

Expression types:
{"type":"constant","value":0.5}
{"type":"feature","name":"cpuFit"}
{"type":"arithmetic","op":"multiply","left":EXPR,"right":EXPR}
{"type":"if","condition":CONDITION,"then":EXPR,"else":EXPR}

Arithmetic operators: add, subtract, multiply, divide.
Comparison operators: lt, lte, gt, gte, eq, neq.
Boolean conditions:
{"type":"boolean","op":"and","left":CONDITION,"right":CONDITION}
{"type":"boolean","op":"or","left":CONDITION,"right":CONDITION}
{"type":"not","value":CONDITION}

Required JSON shape:
{
  "policyName": "descriptive-name",
  "hypothesis": "A testable scheduling hypothesis",
  "weights": {},
  "rejectIfNoServerFits": true,
  "tieBreak": "lowest_server_index",
  "expressions": {
    "placementScore": NUMERIC_EXPRESSION,
    "taskOrderingScore": NUMERIC_EXPRESSION
  }
}

Higher placementScore means a server is preferred.
Higher taskOrderingScore means a task is scheduled earlier.

Generate expression-based policies only. Keep weights empty.
Do not select or copy a predefined baseline.
Do not merely rename a previous policy.
Do not claim an improvement before evaluation.
The simulator enforces resource feasibility.
`;

function buildPrompt(context: PolicyPromptContext): string {
  const attempts = context.pastAttempts.length
    ? context.pastAttempts.map((attempt, index) => {
      const score = attempt.overallScore === null
        ? 'not evaluated'
        : attempt.overallScore.toFixed(4);

      return [
        `ATTEMPT ${index + 1}`,
        `Score: ${score}`,
        `Outcome: ${attempt.summary}`,
        `Policy: ${JSON.stringify(attempt.policy)}`,
      ].join('\n');
    }).join('\n\n')
    : 'No previous attempts.';

  return `
SCENARIO
${context.scenario}

SERVERS
${context.serverCountSummary}

WORKLOAD
${context.sampleWorkloadSummary}

WORKLOAD PROFILE
${context.workloadProfile}

BASELINE RESULTS
${context.baselineSummary}

PREVIOUS ATTEMPTS — STUDY THESE BEFORE GENERATING
${attempts}

DIAGNOSIS
${context.diagnosis}

GENERATION RULES
${context.strategyMenu}

Approved feature names:
${context.allowedFeatures.join(', ')}

Your task:
1. Identify a measurable scheduling trade-off in the results.
2. Examine every previous formula shown above.
3. Do not repeat an earlier formula or merely change its name.
4. If an attempt was rejected as a duplicate, change the actual
   expression tree, not its name, hypothesis, or JSON key ordering.
5. If a policy was evaluated, use its metric results to guide the
   next hypothesis. Do not assume a lower score is an improvement.
6. Generate one new placementScore and taskOrderingScore.
7. Prefer a meaningfully different formula using the approved
   features, arithmetic, and conditionals. Do not add random constants
   solely to evade structural duplicate detection.
8. Return only the required JSON object.

The simulator, not you, determines whether the policy performs better.
`;
}
