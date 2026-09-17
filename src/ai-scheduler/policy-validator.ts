import { ALLOWED_POLICY_FEATURES, PolicyProposal } from './llm-provider';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const MIN_WEIGHT = -1;
const MAX_WEIGHT = 1;

/**
 * Stage 1 of the safety gate: schema + range validation. No simulation is
 * run here - this is a pure, synchronous check of the shape a model
 * returned. Runs identically regardless of which LLMProvider produced
 * the proposal.
 */
export function validatePolicySchema(policy: unknown): ValidationResult {
  if (typeof policy !== 'object' || policy === null) {
    return { valid: false, reason: 'Policy is not an object' };
  }
  const p = policy as Partial<PolicyProposal>;

  if (typeof p.policyName !== 'string' || p.policyName.trim().length === 0) {
    return { valid: false, reason: 'Missing or empty policyName' };
  }
  if (typeof p.weights !== 'object' || p.weights === null) {
    return { valid: false, reason: 'Missing weights object' };
  }
  const weightKeys = Object.keys(p.weights);
  if (weightKeys.length === 0) {
    return { valid: false, reason: 'weights object is empty' };
  }
  for (const key of weightKeys) {
    if (!(ALLOWED_POLICY_FEATURES as readonly string[]).includes(key)) {
      return { valid: false, reason: `Unknown feature "${key}" is not in the allowed feature list` };
    }
    const value = (p.weights as Record<string, unknown>)[key];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return { valid: false, reason: `Weight for "${key}" is not a valid number` };
    }
    if (value < MIN_WEIGHT || value > MAX_WEIGHT) {
      return { valid: false, reason: `Weight for "${key}" (${value}) is outside the allowed range [${MIN_WEIGHT}, ${MAX_WEIGHT}]` };
    }
  }
  if (typeof p.rejectIfNoServerFits !== 'boolean') {
    return { valid: false, reason: 'rejectIfNoServerFits must be true or false' };
  }
  if (p.tieBreak !== 'lowest_server_index' && p.tieBreak !== 'highest_server_index') {
    return { valid: false, reason: 'tieBreak must be "lowest_server_index" or "highest_server_index"' };
  }

  return { valid: true };
}
