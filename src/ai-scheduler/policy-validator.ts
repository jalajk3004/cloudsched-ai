
import {
  ALLOWED_POLICY_FEATURES,
  ArithmeticOperator,
  BooleanOperator,
  ComparisonOperator,
  ConditionExpression,
  NumericExpression,
  PolicyProposal,
} from './llm-provider';

import { STRATEGY_LIBRARY } from './strategy-library';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const MIN_WEIGHT = -1;
const MAX_WEIGHT = 1;
const MAX_DEPTH = 8;
const MAX_NODES = 100;
const MAX_RULES = 12;
const MAX_NAME_LENGTH = 80;

const arithmeticOps: ArithmeticOperator[] = [
  'add',
  'subtract',
  'multiply',
  'divide',
];

const comparisonOps: ComparisonOperator[] = [
  'lt',
  'lte',
  'gt',
  'gte',
  'eq',
  'neq',
];

const booleanOps: BooleanOperator[] = ['and', 'or'];

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validateExpression(
  value: unknown,
  depth: number,
  budget: { nodes: number },
): string | undefined {
  budget.nodes++;

  if (budget.nodes > MAX_NODES) {
    return 'Expression exceeds node limit';
  }

  if (depth > MAX_DEPTH) {
    return 'Expression exceeds maximum depth';
  }

  if (!isObject(value)) {
    return 'Expression must be an object';
  }

  switch (value.type) {
    case 'constant':
      if (
        typeof value.value !== 'number' ||
        !Number.isFinite(value.value)
      ) {
        return 'Constant must be a finite number';
      }

      return undefined;

    case 'feature':
      if (
        typeof value.name !== 'string' ||
        !(ALLOWED_POLICY_FEATURES as readonly string[]).includes(
          value.name,
        )
      ) {
        return `Unknown or unavailable feature: ${String(value.name)}`;
      }

      return undefined;

    case 'arithmetic': {
      if (
        !arithmeticOps.includes(
          value.op as ArithmeticOperator,
        )
      ) {
        return `Invalid arithmetic operator: ${String(value.op)}`;
      }

      const leftError = validateExpression(
        value.left,
        depth + 1,
        budget,
      );

      if (leftError) {
        return leftError;
      }

      return validateExpression(
        value.right,
        depth + 1,
        budget,
      );
    }

    case 'if': {
      const conditionError = validateCondition(
        value.condition,
        depth + 1,
        budget,
      );

      if (conditionError) {
        return conditionError;
      }

      const thenError = validateExpression(
        value.then,
        depth + 1,
        budget,
      );

      if (thenError) {
        return thenError;
      }

      return validateExpression(
        value.else,
        depth + 1,
        budget,
      );
    }

    default:
      return `Unknown expression type: ${String(value.type)}`;
  }
}

function validateCondition(
  value: unknown,
  depth: number,
  budget: { nodes: number },
): string | undefined {
  budget.nodes++;

  if (budget.nodes > MAX_NODES) {
    return 'Expression exceeds node limit';
  }

  if (depth > MAX_DEPTH) {
    return 'Expression exceeds maximum depth';
  }

  if (!isObject(value)) {
    return 'Condition must be an object';
  }

  /*
   * Accept both logical condition representations:
   *
   * Format A:
   * { type: "boolean", op: "and", left: ..., right: ... }
   *
   * Format B:
   * { type: "and", left: ..., right: ... }
   *
   * Both are normalized here for validation. The interpreter must
   * support the same formats for successful execution.
   */

  if (value.type === 'and' || value.type === 'or') {
    const leftError = validateCondition(
      value.left,
      depth + 1,
      budget,
    );

    if (leftError) {
      return leftError;
    }

    return validateCondition(
      value.right,
      depth + 1,
      budget,
    );
  }

  switch (value.type) {
    case 'compare': {
      if (
        !comparisonOps.includes(
          value.op as ComparisonOperator,
        )
      ) {
        return `Invalid comparison operator: ${String(value.op)}`;
      }

      const leftError = validateExpression(
        value.left,
        depth + 1,
        budget,
      );

      if (leftError) {
        return leftError;
      }

      return validateExpression(
        value.right,
        depth + 1,
        budget,
      );
    }

    case 'boolean': {
      if (
        !booleanOps.includes(
          value.op as BooleanOperator,
        )
      ) {
        return `Invalid boolean operator: ${String(value.op)}`;
      }

      const leftError = validateCondition(
        value.left,
        depth + 1,
        budget,
      );

      if (leftError) {
        return leftError;
      }

      return validateCondition(
        value.right,
        depth + 1,
        budget,
      );
    }

    case 'not':
      return validateCondition(
        value.value,
        depth + 1,
        budget,
      );

    default:
      return `Unknown condition type: ${String(value.type)}`;
  }
}

export function validatePolicySchema(
  policy: unknown,
): ValidationResult {
  if (!isObject(policy)) {
    return {
      valid: false,
      reason: 'Policy is not an object',
    };
  }

  const p = policy as unknown as Partial<PolicyProposal>;

  if (
    typeof p.policyName !== 'string' ||
    p.policyName.trim().length === 0 ||
    p.policyName.length > MAX_NAME_LENGTH
  ) {
    return {
      valid: false,
      reason:
        'policyName must be a non-empty string of at most 80 characters',
    };
  }

  if (
    p.baseStrategy !== undefined &&
    (
      typeof p.baseStrategy !== 'string' ||
      !Object.prototype.hasOwnProperty.call(
        STRATEGY_LIBRARY,
        p.baseStrategy,
      )
    )
  ) {
    return {
      valid: false,
      reason:
        `baseStrategy must be one of: ${Object.keys(STRATEGY_LIBRARY).join(', ')
        }`,
    };
  }

  if (
    p.hypothesis !== undefined &&
    (
      typeof p.hypothesis !== 'string' ||
      p.hypothesis.length > 500
    )
  ) {
    return {
      valid: false,
      reason: 'hypothesis must be a string of at most 500 characters',
    };
  }

  if (!isObject(p.weights)) {
    return {
      valid: false,
      reason: 'weights must be an object',
    };
  }

  const weightKeys = Object.keys(p.weights);

  for (const key of weightKeys) {
    if (
      !(ALLOWED_POLICY_FEATURES as readonly string[]).includes(key)
    ) {
      return {
        valid: false,
        reason: `Unknown feature "${key}"`,
      };
    }

    const weight = p.weights[key as keyof typeof p.weights];

    if (
      typeof weight !== 'number' ||
      !Number.isFinite(weight)
    ) {
      return {
        valid: false,
        reason: `Weight for "${key}" must be finite`,
      };
    }

    if (weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
      return {
        valid: false,
        reason: `Weight for "${key}" is outside [-1, 1]`,
      };
    }
  }

  if (
    weightKeys.length === 0 &&
    !p.baseStrategy &&
    !p.expressions
  ) {
    return {
      valid: false,
      reason: 'Policy needs weights, a baseStrategy, or expressions',
    };
  }

  if (typeof p.rejectIfNoServerFits !== 'boolean') {
    return {
      valid: false,
      reason: 'rejectIfNoServerFits must be boolean',
    };
  }

  if (
    p.tieBreak !== 'lowest_server_index' &&
    p.tieBreak !== 'highest_server_index'
  ) {
    return {
      valid: false,
      reason: 'Invalid tieBreak value',
    };
  }

  if (p.expressions !== undefined) {
    if (!isObject(p.expressions)) {
      return {
        valid: false,
        reason: 'expressions must be an object',
      };
    }

    const expressions = p.expressions;
    const budget = { nodes: 0 };

    if (
      expressions.placementScore === undefined &&
      expressions.taskOrderingScore === undefined &&
      expressions.placementRules === undefined
    ) {
      return {
        valid: false,
        reason: 'expressions contains no usable logic',
      };
    }

    if (expressions.placementScore !== undefined) {
      const error = validateExpression(
        expressions.placementScore as NumericExpression,
        0,
        budget,
      );

      if (error) {
        return {
          valid: false,
          reason: error,
        };
      }
    }

    if (expressions.taskOrderingScore !== undefined) {
      const error = validateExpression(
        expressions.taskOrderingScore as NumericExpression,
        0,
        budget,
      );

      if (error) {
        return {
          valid: false,
          reason: error,
        };
      }
    }

    if (expressions.placementRules !== undefined) {
      if (!Array.isArray(expressions.placementRules)) {
        return {
          valid: false,
          reason: 'placementRules must be an array',
        };
      }

      if (expressions.placementRules.length > MAX_RULES) {
        return {
          valid: false,
          reason: `Maximum ${MAX_RULES} placement rules allowed`,
        };
      }

      for (const rule of expressions.placementRules) {
        if (!isObject(rule)) {
          return {
            valid: false,
            reason: 'Each placement rule must be an object',
          };
        }

        if (
          typeof rule.name !== 'string' ||
          rule.name.trim().length === 0 ||
          rule.name.length > MAX_NAME_LENGTH
        ) {
          return {
            valid: false,
            reason: 'Invalid rule name',
          };
        }

        if (
          typeof rule.priority !== 'number' ||
          !Number.isInteger(rule.priority) ||
          rule.priority < 0 ||
          rule.priority > 100
        ) {
          return {
            valid: false,
            reason:
              'Rule priority must be an integer in [0, 100]',
          };
        }

        const conditionError = validateCondition(
          rule.condition as ConditionExpression,
          0,
          budget,
        );

        if (conditionError) {
          return {
            valid: false,
            reason: conditionError,
          };
        }

        const scoreError = validateExpression(
          rule.score as NumericExpression,
          0,
          budget,
        );

        if (scoreError) {
          return {
            valid: false,
            reason: scoreError,
          };
        }
      }
    }
  }

  return { valid: true };
}
