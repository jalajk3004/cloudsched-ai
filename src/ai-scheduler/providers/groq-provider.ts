import { LLMProvider, PolicyPromptContext, PolicyProposal } from '../llm-provider';

/**
 * ============================================================
 *  OWNER: Member 1
 *  MODEL: Groq (e.g. llama-3.3-70b-versatile via the Groq API)
 * ============================================================
 *
 * TODO (Member 1):
 *   1. Add GROQ_API_KEY to your local .env (never commit it).
 *   2. Install the Groq SDK: npm install groq-sdk
 *   3. Build a prompt from `context` (scenario, server summary,
 *      sample workload summary, allowed features, past attempts).
 *   4. Call the Groq chat completion endpoint, requesting JSON output
 *      matching the PolicyProposal shape from ../llm-provider.ts.
 *   5. Parse the response into a PolicyProposal and return it.
 *      Do NOT validate it here - validatePolicySchema() in
 *      ../policy-validator.ts already does that, uniformly for every
 *      provider. Keep this file limited to "talk to Groq, return JSON".
 *
 * Nothing in the rest of the system needs to change once this is
 * filled in - the search loop and AiScheduler only depend on the
 * LLMProvider interface, not on Groq specifically.
 */
export class GroqProvider implements LLMProvider {
  readonly name = 'groq';

  constructor(private apiKey?: string) {}

  async proposePolicy(_context: PolicyPromptContext): Promise<PolicyProposal> {
    throw new Error(
      '[GroqProvider] Not implemented yet. Member 1: implement the Groq API call here. ' +
      'See the TODO comment at the top of this file.',
    );
  }
}
