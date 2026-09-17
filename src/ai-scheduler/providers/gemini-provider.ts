import { LLMProvider, PolicyPromptContext, PolicyProposal } from '../llm-provider';

/**
 * ============================================================
 *  OWNER: Member 2
 *  MODEL: Google Gemini (e.g. gemini-1.5-flash or similar)
 * ============================================================
 *
 * TODO (Member 2):
 *   1. Add GEMINI_API_KEY to your local .env (never commit it).
 *   2. Install the Gemini SDK: npm install @google/generative-ai
 *   3. Build a prompt from `context` (scenario, server summary,
 *      sample workload summary, allowed features, past attempts).
 *   4. Call the Gemini generateContent endpoint, requesting JSON
 *      output matching the PolicyProposal shape from ../llm-provider.ts.
 *   5. Parse the response into a PolicyProposal and return it.
 *      Do NOT validate it here - validatePolicySchema() in
 *      ../policy-validator.ts already does that, uniformly for every
 *      provider. Keep this file limited to "talk to Gemini, return JSON".
 *
 * Nothing in the rest of the system needs to change once this is
 * filled in - the search loop and AiScheduler only depend on the
 * LLMProvider interface, not on Gemini specifically.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';

  constructor(private apiKey?: string) {}

  async proposePolicy(_context: PolicyPromptContext): Promise<PolicyProposal> {
    throw new Error(
      '[GeminiProvider] Not implemented yet. Member 2: implement the Gemini API call here. ' +
      'See the TODO comment at the top of this file.',
    );
  }
}
