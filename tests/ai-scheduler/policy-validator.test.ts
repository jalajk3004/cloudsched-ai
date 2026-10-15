import { PolicyProposal } from "../../src/ai-scheduler/llm-provider";
import { validatePolicySchema } from "../../src/ai-scheduler/policy-validator";

const basePolicy: PolicyProposal = {
  policyName: 'test-policy',
  weights: {},
  rejectIfNoServerFits: true,
  tieBreak: 'lowest_server_index',
  expressions: {
    placementScore: {
      type: 'feature',
      name: 'cpuFit',
    },
  },
};

describe('validatePolicySchema', () => {
  it('accepts a valid expression policy', () => {
    expect(validatePolicySchema(basePolicy).valid).toBe(true);
  });

  it('accepts legacy weight-based policies', () => {
    const policy: PolicyProposal = {
      policyName: 'legacy-policy',
      baseStrategy: 'tight_packing',
      weights: { cpuFit: 0.8 },
      rejectIfNoServerFits: true,
      tieBreak: 'lowest_server_index',
    };

    expect(validatePolicySchema(policy).valid).toBe(true);
  });

  it('rejects unknown features', () => {
    const policy = {
      ...basePolicy,
      expressions: {
        placementScore: {
          type: 'feature',
          name: 'taskDuration',
        },
      },
    };

    expect(validatePolicySchema(policy).valid).toBe(false);
  });

  it('rejects unknown operators', () => {
    const policy = {
      ...basePolicy,
      expressions: {
        placementScore: {
          type: 'arithmetic',
          op: 'power',
          left: { type: 'constant', value: 2 },
          right: { type: 'constant', value: 3 },
        },
      },
    };

    expect(validatePolicySchema(policy).valid).toBe(false);
  });

  it('rejects non-finite constants', () => {
    const policy = {
      ...basePolicy,
      expressions: {
        placementScore: {
          type: 'constant',
          value: Infinity,
        },
      },
    };

    expect(validatePolicySchema(policy).valid).toBe(false);
  });

  it('rejects malformed conditions', () => {
    const policy = {
      ...basePolicy,
      expressions: {
        placementScore: {
          type: 'if',
          condition: { type: 'compare', op: 'unknown' },
          then: { type: 'constant', value: 1 },
          else: { type: 'constant', value: 0 },
        },
      },
    };

    expect(validatePolicySchema(policy).valid).toBe(false);
  });
});
