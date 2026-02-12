/**
 * Condition Operators
 * Implements all comparison operators for rule condition evaluation.
 */

import type { ConditionOperator, EmployeeData, RuleCondition, ConditionResult } from './types.js';

// ─────────────────────────────────────────────────────────────
// Operator implementations
// ─────────────────────────────────────────────────────────────

type OperatorFn = (actual: unknown, expected: unknown) => boolean;

const operators: Record<ConditionOperator, OperatorFn> = {
  eq: (actual, expected) => actual === expected,

  neq: (actual, expected) => actual !== expected,

  gt: (actual, expected) => typeof actual === 'number' && typeof expected === 'number' && actual > expected,

  gte: (actual, expected) => typeof actual === 'number' && typeof expected === 'number' && actual >= expected,

  lt: (actual, expected) => typeof actual === 'number' && typeof expected === 'number' && actual < expected,

  lte: (actual, expected) => typeof actual === 'number' && typeof expected === 'number' && actual <= expected,

  in: (actual, expected) => Array.isArray(expected) && expected.includes(actual),

  notIn: (actual, expected) => Array.isArray(expected) && !expected.includes(actual),

  between: (actual, expected) => {
    if (typeof actual !== 'number' || !Array.isArray(expected) || expected.length !== 2) return false;
    const [min, max] = expected as [number, number];
    return typeof min === 'number' && typeof max === 'number' && actual >= min && actual <= max;
  },

  contains: (actual, expected) =>
    typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected),

  startsWith: (actual, expected) =>
    typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected),

  matches: (actual, expected) => {
    if (typeof actual !== 'string' || typeof expected !== 'string') return false;
    try {
      return new RegExp(expected).test(actual);
    } catch {
      return false;
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Field resolution (supports dot-notation)
// ─────────────────────────────────────────────────────────────

export function getFieldValue(employee: EmployeeData, field: string): unknown {
  const parts = field.split('.');
  let current: unknown = employee;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Evaluate a single condition against an employee.
 * Returns a ConditionResult with pass/fail and details.
 */
export function evaluateCondition(
  employee: EmployeeData,
  condition: RuleCondition,
): ConditionResult {
  const actual = getFieldValue(employee, condition.field);
  const operatorFn = operators[condition.operator];
  const passed = operatorFn(actual, condition.value);

  return {
    field: condition.field,
    operator: condition.operator,
    expected: condition.value,
    actual,
    passed,
  };
}

/**
 * Evaluate all conditions for a rule (AND logic).
 * Returns true only if ALL conditions pass.
 */
export function evaluateAllConditions(
  employee: EmployeeData,
  conditions: RuleCondition[],
): { allPassed: boolean; results: ConditionResult[] } {
  const results = conditions.map((c) => evaluateCondition(employee, c));
  const allPassed = results.every((r) => r.passed);
  return { allPassed, results };
}

