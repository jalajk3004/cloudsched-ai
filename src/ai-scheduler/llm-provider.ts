
export const PLACEMENT_FEATURES = [
  'cpuFit',
  'memoryFit',
  'cpuFragmentation',
  'memoryFragmentation',
  'resourceBalance',
  'serverLoad',
  'futureCapacity',
  'normLeftover',
] as const;

export const ORDERING_FEATURES = [
  'taskSize',
  'taskWaitTime',
  'priority',
] as const;

export const ALLOWED_POLICY_FEATURES = [
  ...PLACEMENT_FEATURES,
  ...ORDERING_FEATURES,
] as const;

export type PolicyFeature = typeof ALLOWED_POLICY_FEATURES[number];

export const FEATURE_SET_NAME = 'current';

export const FEATURE_DESCRIPTIONS: Record<PolicyFeature, string> = {
  cpuFit: 'Task CPU divided by free CPU. Higher means tighter CPU packing.',
  memoryFit: 'Task memory divided by free memory. Higher means tighter memory packing.',
  cpuFragmentation: 'Normalized CPU remainder too small for a typical task.',
  memoryFragmentation: 'Normalized memory remainder too small for a typical task.',
  resourceBalance: 'Higher when remaining CPU and memory proportions are balanced.',
  serverLoad: 'Current normalized server load. Higher means busier.',
  futureCapacity: 'Estimated share of future task shapes that remain placeable.',
  normLeftover: 'Normalized leftover CPU plus memory. Lower is tighter packing.',
  taskSize: 'Normalized task size. Used for ordering, not server selection.',
  taskWaitTime: 'Normalized time spent waiting. Used for ordering.',
  priority: 'Normalized task priority. Used for ordering.',
};

export type ArithmeticOperator = 'add' | 'subtract' | 'multiply' | 'divide';
export type ComparisonOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq';
export type BooleanOperator = 'and' | 'or';

export type NumericExpression =
  | { type: 'constant'; value: number }
  | { type: 'feature'; name: PolicyFeature }
  | {
    type: 'arithmetic';
    op: ArithmeticOperator;
    left: NumericExpression;
    right: NumericExpression;
  }
  | {
    type: 'if';
    condition: ConditionExpression;
    then: NumericExpression;
    else: NumericExpression;
  };

export type ConditionExpression =
  | {
    type: 'compare';
    op: ComparisonOperator;
    left: NumericExpression;
    right: NumericExpression;
  }
  | {
    type: 'boolean';
    op: BooleanOperator;
    left: ConditionExpression;
    right: ConditionExpression;
  }
  | { type: 'not'; value: ConditionExpression };

export interface PolicyRule {
  name: string;
  condition: ConditionExpression;
  score: NumericExpression;
  priority: number;
}

export interface PolicyExpressions {
  placementScore?: NumericExpression;
  taskOrderingScore?: NumericExpression;
  placementRules?: PolicyRule[];
}

export interface PolicyProposal {
  policyName: string;
  baseStrategy?: string;
  hypothesis?: string;
  weights: Partial<Record<PolicyFeature, number>>;
  rejectIfNoServerFits: boolean;
  tieBreak: 'lowest_server_index' | 'highest_server_index';

  // Optional new policy format. Existing weight-based policies remain valid.
  expressions?: PolicyExpressions;
}


export interface PastAttempt {
  policy: PolicyProposal;
  overallScore: number | null;
  summary: string;
}


export interface PolicyPromptContext {
  scenario: string;
  serverCountSummary: string;
  sampleWorkloadSummary: string;
  workloadProfile: string;
  allowedFeatures: readonly PolicyFeature[];
  baselineSummary: string;
  strategyMenu: string;
  diagnosis: string;
  pastAttempts: PastAttempt[];
}

export interface LLMProvider {
  readonly name: string;
  proposePolicy(context: PolicyPromptContext): Promise<PolicyProposal>;
}
