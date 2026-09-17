import { LLMProvider, PolicyPromptContext, PolicyProposal } from '../llm-provider';

/**
 * ============================================================
 *  OWNER: Member 3
 *  MODEL: Anthropic Claude (e.g. claude-haiku or similar)
 * ============================================================
 *
 * TODO (Member 3):
 *   1. Add ANTHROPIC_API_KEY to your local .env (never commit it).
 *   2. Install the Anthropic SDK: npm install @anthropic-ai/sdk
 *   3. Build a prompt from `context` (scenario, server summary,
 *      sample workload summary, allowed features, past attempts).
 *   4. Call the Claude messages endpoint, requesting JSON output
 *      matching the PolicyProposal shape from ../llm-provider.ts.
 *   5. Parse the response into a PolicyProposal and return it.
 *      Do NOT validate it here - validatePolicySchema() in
 *      ../policy-validator.ts already does that, uniformly for every
 *      provider. Keep this file limited to "talk to Claude, return JSON".
 *
 * Nothing in the rest of the system needs to change once this is
 * filled in - the search loop and AiScheduler only depend on the
 * LLMProvider interface, not on Claude specifically.
 */
export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';

  constructor(private apiKey?: string) {}

  async proposePolicy(_context: PolicyPromptContext): Promise<PolicyProposal> {
    throw new Error(
      '[ClaudeProvider] Not implemented yet. Member 3: implement the Claude API call here. ' +
      'See the TODO comment at the top of this file.',
    );
  }
}
