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
