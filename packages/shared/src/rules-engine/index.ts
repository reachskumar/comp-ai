/**
 * Rules Engine - Barrel Export
 * Pure TypeScript library for evaluating compensation rules.
 */

// Types
export type {
  RuleType,
  ConditionOperator,
  RuleCondition,
  ActionType,
  RuleAction,
  Rule,
  RuleSet,
  EmployeeData,
  AppliedAction,
  RuleDecision,
  ConditionResult,
  AuditEntry,
  RuleEvaluationResult,
  ProratedAmount,
  SalaryChange,
  RetroBreakdown,
  RetroAdjustment,
  CurrentAmounts,
} from './types.js';

// Operators
export { evaluateCondition, evaluateAllConditions, getFieldValue } from './operators.js';

// Actions
export { executeAction } from './actions.js';
export type { ExecuteActionResult } from './actions.js';

// Evaluator
export { evaluateRules } from './evaluator.js';

// Proration
export { calculateProration } from './proration.js';
export type { ProrateOptions } from './proration.js';

// Retro
export { calculateRetroAdjustment } from './retro.js';

