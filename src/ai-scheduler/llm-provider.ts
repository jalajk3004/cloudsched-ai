// ── LLM Provider contract ───────────────────────────────────────────────
// This is the ONE interface every team member's model integration must
// implement. The AiScheduler, the validator, and the search loop never
// know or care which LLM is behind a given provider - they only ever
// call provider.proposePolicy(...) through this interface.
//
// This file intentionally contains NO real API calls to any LLM. It is
// the shared contract implemented by QwenProvider in ./providers/qwen-provider.ts.

/** The whitelisted, bounded feature set an LLM is allowed to weight.
 *  Nothing outside this list has any effect on scheduling - this is what
 *  keeps the AI scheduler constrained to "tune these numbers", never
 *  "run arbitrary logic". */
export const ALLOWED_POLICY_FEATURES = [
  'leftoverCpuAfterPlacement',
  'leftoverMemAfterPlacement',
  'serverCurrentUtilization',
  'taskPriority',
  'taskWaitTime',
] as const;

export type PolicyFeature = typeof ALLOWED_POLICY_FEATURES[number];

export interface PolicyProposal {
  policyName: string;
  weights: Partial<Record<PolicyFeature, number>>; // each weight must be in [-1, 1]
  rejectIfNoServerFits: boolean;
  tieBreak: 'lowest_server_index' | 'highest_server_index';
}

/** One previous attempt, fed back to the model so it can propose an
 *  improved version next round (the "improve" step of generate-test-
 *  evaluate-improve). */
export interface PastAttempt {
  policy: PolicyProposal;
  overallScore: number; // higher is better
}

/** Everything a model is allowed to know when proposing a policy.
 *  Deliberately excludes any per-task or per-server live simulation
 *  state - that only exists at scheduling time, inside the simulator,
 *  never inside a prompt. */
export interface PolicyPromptContext {
  scenario: string;              // e.g. 'cpu-heavy'
  serverCountSummary: string;    // e.g. "4 servers: 2x(16 CPU/32GB), 2x(8 CPU/16GB)"
  sampleWorkloadSummary: string; // e.g. "50 tasks, avg cpu=6.2, avg mem=1400MB"
  allowedFeatures: readonly PolicyFeature[];
  pastAttempts: PastAttempt[];   // empty on the first round
}

/**
 * The shared contract. Each team member implements this interface backed
 * by a different LLM. The rest of the system (AiScheduler, validator,
 * search loop, simulation engine, metrics) is identical no matter which
 * implementation is plugged in.
 */
export interface LLMProvider {
  /** Short identifier, e.g. 'qwen'. Used for
   *  logging which model produced a given policy. */
  readonly name: string;

  /** Given the current context, propose a policy. Must return a
   *  PolicyProposal (or throw) - the caller (search loop) is responsible
   *  for validating the result before ever using it. */
  proposePolicy(context: PolicyPromptContext): Promise<PolicyProposal>;
}
