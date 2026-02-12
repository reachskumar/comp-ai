/**
 * Monitor Types
 * Shared types for all cycle monitoring services.
 */

// ─── Alert Types ─────────────────────────────────────────────────────────

export type AlertType =
  | 'BUDGET_DRIFT'
  | 'POLICY_VIOLATION'
  | 'OUTLIER'
  | 'EXEC_SUMMARY';

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface MonitorAlert {
  cycleId: string;
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  details: Record<string, unknown>;
  acknowledged?: boolean;
}

// ─── Budget Drift ────────────────────────────────────────────────────────

export interface BudgetDriftResult {
  cycleId: string;
  overallDriftPct: number;
  thresholdPct: number;
  exceeded: boolean;
  departmentDrifts: DepartmentDrift[];
  projection: BudgetProjection;
}

export interface DepartmentDrift {
  department: string;
  managerId: string | null;
  allocated: number;
  spent: number;
  remaining: number;
  driftPct: number;
  exceeded: boolean;
}

export interface BudgetProjection {
  projectedTotal: number;
  budgetTotal: number;
  projectedOverage: number;
  daysRemaining: number;
  dailyBurnRate: number;
}

// ─── Policy Violation ────────────────────────────────────────────────────

export type ViolationType =
  | 'EXCEEDS_CAP'
  | 'BELOW_FLOOR'
  | 'MISSING_ELIGIBILITY'
  | 'EXCEEDS_BUDGET'
  | 'UNAPPROVED_EXCEPTION'
  | 'BLOCKED_BY_RULE';

export interface PolicyViolation {
  recommendationId: string;
  employeeId: string;
  employeeName: string;
  department: string;
  violationType: ViolationType;
  ruleName: string;
  ruleId: string;
  details: string;
  severity: AlertSeverity;
}

export interface PolicyViolationResult {
  cycleId: string;
  totalViolations: number;
  violations: PolicyViolation[];
  bySeverity: Record<AlertSeverity, number>;
  byType: Record<string, number>;
}

// ─── Outlier Detection ───────────────────────────────────────────────────

export type OutlierType =
  | 'STATISTICAL_OUTLIER'
  | 'LARGE_YOY_CHANGE'
  | 'COMPRESSION_RISK'
  | 'INVERSION_RISK'
  | 'EQUITY_GAP';

export interface OutlierRecord {
  recommendationId: string;
  employeeId: string;
  employeeName: string;
  department: string;
  level: string;
  outlierType: OutlierType;
  value: number;
  cohortMean: number;
  cohortStdDev: number;
  zScore: number;
  details: string;
  severity: AlertSeverity;
}

export interface OutlierResult {
  cycleId: string;
  totalOutliers: number;
  outliers: OutlierRecord[];
  byType: Record<string, number>;
  bySeverity: Record<AlertSeverity, number>;
}

// ─── Exec Summary ────────────────────────────────────────────────────────

export interface ExecSummary {
  cycleId: string;
  cycleName: string;
  generatedAt: string;
  budgetStatus: BudgetDriftResult;
  topViolations: PolicyViolation[];
  outlierList: OutlierRecord[];
  cycleProgress: CycleProgress;
  blockers: string[];
  actionItems: string[];
}

export interface CycleProgress {
  status: string;
  totalRecommendations: number;
  byStatus: Record<string, number>;
  completionPct: number;
  daysElapsed: number;
  daysRemaining: number;
}

// ─── Monitor Run ─────────────────────────────────────────────────────────

export interface MonitorRunResult {
  cycleId: string;
  runAt: string;
  budgetDrift: BudgetDriftResult;
  policyViolations: PolicyViolationResult;
  outliers: OutlierResult;
  alertsCreated: number;
}

