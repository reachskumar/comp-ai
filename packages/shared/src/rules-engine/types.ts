/**
 * Rule Engine Types
 * Pure TypeScript types for the compensation rules engine.
 * Matches the Prisma schema RuleType enum and Rule/RuleSet models.
 */

// ─────────────────────────────────────────────────────────────
// Enums (mirroring Prisma)
// ─────────────────────────────────────────────────────────────

export type RuleType =
  | 'MERIT'
  | 'BONUS'
  | 'LTI'
  | 'PRORATION'
  | 'CAP'
  | 'FLOOR'
  | 'ELIGIBILITY'
  | 'CUSTOM';

// ─────────────────────────────────────────────────────────────
// Condition types
// ─────────────────────────────────────────────────────────────

export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'between'
  | 'contains'
  | 'startsWith'
  | 'matches';

export interface RuleCondition {
  /** Dot-notation path on employee data (e.g., "department", "level", "baseSalary") */
  field: string;
  operator: ConditionOperator;
  /** Comparison value: string, number, string[], [number, number] for between, regex string for matches */
  value: unknown;
}

// ─────────────────────────────────────────────────────────────
// Action types
// ─────────────────────────────────────────────────────────────

export type ActionType =
  | 'setMerit'
  | 'setBonus'
  | 'setLTI'
  | 'applyMultiplier'
  | 'applyFloor'
  | 'applyCap'
  | 'flag'
  | 'block';

export interface RuleAction {
  type: ActionType;
  /** Action parameters, e.g., { percentage: 5 } for setMerit, { amount: 50000 } for applyFloor */
  params: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Rule & RuleSet
// ─────────────────────────────────────────────────────────────

export interface Rule {
  id: string;
  name: string;
  description?: string;
  type: RuleType;
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** Lower number = higher priority */
  priority: number;
  enabled: boolean;
}

export interface RuleSet {
  id: string;
  name: string;
  rules: Rule[];
  effectiveDate?: Date;
}

// ─────────────────────────────────────────────────────────────
// Employee data (minimal interface for evaluation)
// ─────────────────────────────────────────────────────────────

export interface EmployeeData {
  id: string;
  employeeCode: string;
  department: string;
  level: string;
  title?: string;
  location?: string;
  baseSalary: number;
  hireDate: Date;
  terminationDate?: Date;
  performanceRating?: number;
  managerId?: string;
  /** Allow additional fields for custom conditions */
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────
// Evaluation results
// ─────────────────────────────────────────────────────────────

export interface AppliedAction {
  type: ActionType;
  params: Record<string, unknown>;
  /** The computed result (e.g., merit amount, bonus amount) */
  calculatedValue: number;
  /** Human-readable description */
  description: string;
}

export interface RuleDecision {
  ruleId: string;
  ruleName: string;
  ruleType: RuleType;
  actions: AppliedAction[];
}

export interface ConditionResult {
  field: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

export interface AuditEntry {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  conditionResults: ConditionResult[];
  timestamp: Date;
}

export interface RuleEvaluationResult {
  employeeId: string;
  decisions: RuleDecision[];
  appliedRules: string[];
  skippedRules: string[];
  auditTrail: AuditEntry[];
  warnings: string[];
  /** Aggregated merit amount */
  totalMerit: number;
  /** Aggregated bonus amount */
  totalBonus: number;
  /** Aggregated LTI amount */
  totalLTI: number;
  /** True if any block action fired */
  blocked: boolean;
  /** Flag messages from flag actions */
  flags: string[];
}

// ─────────────────────────────────────────────────────────────
// Proration types
// ─────────────────────────────────────────────────────────────

export interface ProratedAmount {
  originalAmount: number;
  proratedAmount: number;
  /** Fraction of the period the employee was eligible (0-1) */
  prorationFactor: number;
  eligibleDays: number;
  totalDays: number;
  description: string;
}

// ─────────────────────────────────────────────────────────────
// Retro types
// ─────────────────────────────────────────────────────────────

export interface SalaryChange {
  oldSalary: number;
  newSalary: number;
  effectiveDate: Date;
}

export interface RetroBreakdown {
  periodStart: Date;
  periodEnd: Date;
  oldSalary: number;
  newSalary: number;
  difference: number;
  days: number;
}

export interface RetroAdjustment {
  totalAdjustment: number;
  breakdown: RetroBreakdown[];
  periodStart: Date;
  periodEnd: Date;
}

// ─────────────────────────────────────────────────────────────
// Current amounts (used during action execution)
// ─────────────────────────────────────────────────────────────

export interface CurrentAmounts {
  merit: number;
  bonus: number;
  lti: number;
}

