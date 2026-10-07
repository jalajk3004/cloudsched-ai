import { LLMProvider, PolicyPromptContext, PolicyProposal, ALLOWED_POLICY_FEATURES } from '../llm-provider';

/**
 * ============================================================
 *  MODEL: Qwen3, run locally via Ollama (default tag: qwen3:4b)
 * ============================================================
 *
 * This talks to a local Ollama server running on this machine over plain HTTP.
 * No external API key is needed.
 *
 * SETUP (done once, outside this code):
 *   1. Install Ollama from https://ollama.com
 *   2. Run: ollama pull qwen3:4b
 *   3. Confirm it works: ollama run qwen3:4b
 * Ollama runs as a local background service on http://localhost:11434
 * by default - nothing in this file needs an internet connection once
 * the model has been pulled.
 */
export class QwenProvider implements LLMProvider {
  readonly name = 'qwen';

  constructor(
    private host: string = process.env.OLLAMA_HOST || 'http://localhost:11434',
    private model: string = process.env.OLLAMA_MODEL || 'qwen3:4b',
  ) { }

  async proposePolicy(context: PolicyPromptContext): Promise<PolicyProposal> {
    const prompt = buildPrompt(context);

    let response: Response;
    try {
      response = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          format: 'json', // Ollama's native JSON-mode flag
          stream: false,
        }),
      });
    } catch (err) {
      throw new Error(
        `[QwenProvider] Could not reach Ollama at ${this.host}. Is Ollama running? ` +
        `(Original error: ${(err as Error).message})`,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`[QwenProvider] Ollama returned HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json() as { message?: { content?: string } };
    const raw = data.message?.content;
    if (!raw) {
      throw new Error('[QwenProvider] Empty response from Ollama.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`[QwenProvider] Model did not return valid JSON: ${raw.slice(0, 200)}`);
    }

    return parsed as PolicyProposal;
  }
}

// Prompt instructions to constrain model output to valid PolicyProposal JSON.
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