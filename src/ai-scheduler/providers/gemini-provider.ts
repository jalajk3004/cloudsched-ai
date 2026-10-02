import { GoogleGenAI } from '@google/genai';
import { LLMProvider, PolicyPromptContext, PolicyProposal, ALLOWED_POLICY_FEATURES } from '../llm-provider';

/**
 * ============================================================
 *  OWNER: Member 2
 *  MODEL: Google Gemini (gemini-2.5-flash)
 * ============================================================
 *
 * This talks to the Gemini API and returns whatever JSON it produces,
 * parsed into a PolicyProposal shape. It does NOT validate the result -
 * that's validatePolicySchema()'s job in ../policy-validator.ts, applied
 * uniformly to every provider's output, regardless of which model
 * produced it.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey?: string, model: string = 'gemini-2.5-flash') {
    const key = apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('[GeminiProvider] No API key found. Set GEMINI_API_KEY in your .env file.');
    }
    this.client = new GoogleGenAI({ apiKey: key });
    this.model = model;
  }

  async proposePolicy(context: PolicyPromptContext): Promise<PolicyProposal> {
    const prompt = buildPrompt(context);

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
      },
    });

    const raw = response.text;
    if (!raw) {
      throw new Error('[GeminiProvider] Empty response from Gemini.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`[GeminiProvider] Gemini did not return valid JSON: ${raw.slice(0, 200)}`);
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