import { LLMProvider, PolicyPromptContext, PolicyProposal } from '../llm-provider';

/**
 * ============================================================
 *  OWNER: Member 3
 *  MODEL: A free model hosted on Hugging Face (e.g. Qwen3, or another
 *         free-tier instruction-following model available via the
 *         Hugging Face Inference API). Exact model choice is still
 *         being decided - swap MODEL_ID below once picked.
 * ============================================================
 *
 * TODO (Member 3):
 *   1. Create a free Hugging Face account and an access token at
 *      https://huggingface.co/settings/tokens
 *   2. Add HUGGINGFACE_API_KEY to your local .env (never commit it).
 *   3. Pick a specific model (e.g. a Qwen3 instruct variant) that is
 *      available on the free Hugging Face Inference API, and set its
 *      model id below.
 *   4. Install a client if you want one: npm install @huggingface/inference
 *      (or call the REST API directly with fetch - either is fine).
 *   5. Build a prompt from `context` (scenario, server summary, sample
 *      workload summary, allowed features, past attempts) and ask the
 *      model to return ONLY a JSON object matching PolicyProposal from
 *      ../llm-provider.ts. Free-tier instruction models are sometimes
 *      less reliable at strict JSON output than larger hosted models -
 *      you may want to ask for JSON explicitly in the prompt and/or
 *      strip markdown code fences from the response before parsing.
 *   6. Parse the response into a PolicyProposal and return it. Do NOT
 *      validate it here - validatePolicySchema() in ../policy-validator.ts
 *      already does that, uniformly for every provider. Keep this file
 *      limited to "talk to the model, return JSON".
 *
 * Nothing in the rest of the system needs to change once this is filled
 * in - the search loop and AiScheduler only depend on the LLMProvider
 * interface, not on which model or hosting service is behind it.
 */
export class HuggingFaceProvider implements LLMProvider {
  readonly name = 'huggingface';

  constructor(private apiKey?: string, private modelId: string = 'TODO-set-a-real-model-id') {}

  async proposePolicy(_context: PolicyPromptContext): Promise<PolicyProposal> {
    throw new Error(
      '[HuggingFaceProvider] Not implemented yet. Member 3: implement the Hugging Face ' +
      '(e.g. Qwen3) API call here. See the TODO comment at the top of this file.',
    );
  }
}
