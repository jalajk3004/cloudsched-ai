import { validatePolicySchema } from '../../src/ai-scheduler/policy-validator';

describe('validatePolicySchema', () => {
  it('accepts a well-formed policy', () => {
    const result = validatePolicySchema({
      policyName: 'test-policy',
      weights: { leftoverCpuAfterPlacement: -0.5, taskPriority: 0.6 },
      rejectIfNoServerFits: true,
      tieBreak: 'lowest_server_index',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a policy with an unknown feature name', () => {
    const result = validatePolicySchema({
      policyName: 'bad-policy',
      weights: { madeUpFeature: 0.5 },
      rejectIfNoServerFits: true,
      tieBreak: 'lowest_server_index',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not in the allowed feature list/);
  });

  it('rejects a weight outside the [-1, 1] range', () => {
    const result = validatePolicySchema({
      policyName: 'out-of-range',
      weights: { taskPriority: 5 },
      rejectIfNoServerFits: true,
      tieBreak: 'lowest_server_index',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/outside the allowed range/);
  });

  it('rejects a missing policyName', () => {
    const result = validatePolicySchema({
      weights: { taskPriority: 0.5 },
      rejectIfNoServerFits: true,
      tieBreak: 'lowest_server_index',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a non-object input entirely (e.g. malformed LLM output)', () => {
    const result = validatePolicySchema('this is not a policy, just text the LLM returned');
    expect(result.valid).toBe(false);
  });

  it('rejects an invalid tieBreak value', () => {
    const result = validatePolicySchema({
      policyName: 'bad-tiebreak',
      weights: { taskPriority: 0.5 },
      rejectIfNoServerFits: true,
      tieBreak: 'random',
    });
    expect(result.valid).toBe(false);
  });
});
