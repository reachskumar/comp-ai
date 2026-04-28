/**
 * Pay Equity AI agent contract.
 *
 * Every Pay Equity agent (narrative report, cohort root-cause, remediation
 * solver, projection) MUST return a `PayEquityAgentResult<T>`. This contract
 * is what makes the platform auditor-defensible:
 *   - `citations[]` — every factual claim references a data row, regression
 *     coefficient, policy line, or external source.
 *   - `methodology` — the statistical method version + control variables,
 *     so an auditor can see "the same model produced this report year-over-year"
 *     and a model upgrade can't silently change interpretation.
 *   - `runId` — FK to a `PayEquityRun` row, so the run is reproducible.
 *
 * See `PAY_EQUITY_CONTEXT.md` § 2 for the full architecture.
 */

/** Where a claim came from. */
export type CitationType =
  | 'employee_row' // a specific Employee.id
  | 'cohort_query' // a SQL-like query hash + parameters
  | 'regression_coefficient' // a coefficient + p-value from a model run
  | 'policy_line' // a line in an uploaded policy document
  | 'external_source' // a market dataset, statute, etc.
  | 'prior_run'; // a previous PayEquityRun.id (for trend claims)

export interface Citation {
  type: CitationType;
  /** ID, line number, query hash, URL, or run id depending on type. */
  ref: string;
  /** Optional snippet shown next to the claim in the UI. */
  excerpt?: string;
}

/** Confidence the agent has in its own output. */
export type AgentConfidence = 'high' | 'medium' | 'low';

/** A frozen description of how the analysis was performed. */
export interface PayEquityMethodology {
  /** Stable identifier — e.g. 'edge-multivariate-v2', 'oaxaca-blinder-v1'. */
  name: string;
  version: string;
  /** Predictors used in the regression (e.g. ['level','tenure','location']). */
  controls: string[];
  /** Dependent variable form ('log_salary', 'log_total_comp'). */
  dependentVariable: 'log_salary' | 'log_total_comp' | 'salary' | 'total_comp';
  sampleSize: number;
  /** Two-tailed CI used for coefficient bounds (e.g. 0.95). */
  confidenceInterval: number;
  /**
   * Compliance threshold applied to the gap (e.g. EDGE Standard ±5%).
   * Null when no compliance regime is being checked.
   */
  complianceThreshold?: number;
  /** LLM model name + version that generated the narrative. */
  llmModel?: string;
  llmModelVersion?: string;
}

/** Warning surfaced to the user — never a silent failure. */
export interface AgentWarning {
  code: AgentWarningCode;
  message: string;
}

export type AgentWarningCode =
  | 'sample_size_low' // any cohort with n < 30
  | 'k_anonymity_violation' // any cohort with n < 5 was suppressed
  | 'missing_protected_class' // race/ethnicity unavailable
  | 'methodology_drift' // a previous run used a different methodology
  | 'data_quality' // input data has issues that may affect results
  | 'model_unavailable'; // LLM unavailable; deterministic-only output

/**
 * The wrapper every Pay Equity agent returns. Generic over the structured
 * output type produced by the specific agent.
 */
export interface PayEquityAgentResult<T> {
  /** The structured / narrative output specific to this agent. */
  output: T;
  /** Every factual claim must be backed. Empty array is suspicious. */
  citations: Citation[];
  methodology: PayEquityMethodology;
  confidence: AgentConfidence;
  warnings: AgentWarning[];
  /** FK to PayEquityRun. Set by the calling service, not the agent itself. */
  runId: string;
  /** ISO timestamp the agent produced the output. */
  generatedAt: string;
}

// ─── Per-agent output shapes ────────────────────────────────────────────────

/** Narrative report agent (existing pay-equity-graph). */
export interface PayEquityNarrativeOutput {
  executiveSummary: string;
  edgeComplianceStatus: 'pass' | 'fail' | 'mixed' | 'not_applicable';
  keyFindings: string[];
  riskAssessment: Array<{
    dimension: string;
    riskLevel: 'high' | 'medium' | 'low';
    rationale: string;
  }>;
  remediationRecommendations: Array<{
    action: string;
    estimatedCost?: number;
    affectedEmployees?: number;
    priority: 'high' | 'medium' | 'low';
  }>;
  methodologyNote: string;
  /** Full narrative report rendered as markdown for export. */
  fullReportMarkdown: string;
}

/** Cohort root-cause agent (Phase 1.5). */
export interface CohortRootCauseOutput {
  cohort: { dimension: string; group: string };
  rootCauses: Array<{
    factor: string;
    contribution: number; // 0..1
    explanation: string;
  }>;
  driverEmployees: string[]; // employee IDs driving the gap (top contributors)
  recommendedNextStep: string;
}

/** Remediation optimization agent (Phase 2.3). */
export interface RemediationOptimizationOutput {
  targetGap: number;
  totalCost: number;
  affectedEmployees: number;
  adjustments: Array<{
    employeeId: string;
    fromValue: number;
    toValue: number;
    justification: string;
  }>;
  alternativeScenarios: Array<{
    label: string;
    targetGap: number;
    cost: number;
    summary: string;
  }>;
}

/** Forward gap projection agent (Phase 4.1). */
export interface GapProjectionOutput {
  horizonMonths: number;
  baselineGap: number;
  projectedGap: number;
  confidenceLow: number;
  confidenceHigh: number;
  monthlySeries: Array<{ monthsFromNow: number; projectedGapPercent: number }>;
  drivers: Array<{ factor: string; expectedDelta: number; explanation: string }>;
  recommendedActions: Array<{
    action: string;
    priority: 'high' | 'medium' | 'low';
    rationale: string;
  }>;
  narrative: string;
  riskLevel: 'high' | 'medium' | 'low';
  scenarioLabel: string;
}

// ─── Helper builders ────────────────────────────────────────────────────────

/**
 * Helper for agents to build a result without forgetting required fields.
 * The runId and generatedAt are typically set by the calling service.
 */
export function buildResult<T>(args: {
  output: T;
  citations: Citation[];
  methodology: PayEquityMethodology;
  confidence: AgentConfidence;
  warnings?: AgentWarning[];
  runId?: string;
  generatedAt?: string;
}): PayEquityAgentResult<T> {
  return {
    output: args.output,
    citations: args.citations,
    methodology: args.methodology,
    confidence: args.confidence,
    warnings: args.warnings ?? [],
    runId: args.runId ?? '',
    generatedAt: args.generatedAt ?? new Date().toISOString(),
  };
}

/** Cohort sample-size guard. Returns warnings for cohorts that fail k-anonymity. */
export function checkKAnonymity(
  cohorts: Array<{ name: string; n: number }>,
  threshold = 5,
): AgentWarning[] {
  const violations = cohorts.filter((c) => c.n < threshold);
  if (violations.length === 0) return [];
  return [
    {
      code: 'k_anonymity_violation',
      message: `Suppressed ${violations.length} cohort(s) below k=${threshold}: ${violations
        .map((v) => `${v.name} (n=${v.n})`)
        .join(', ')}`,
    },
  ];
}

/** Sample-size warning for cohorts below the n=30 statistical-meaningfulness threshold. */
export function checkSampleSize(
  cohorts: Array<{ name: string; n: number }>,
  threshold = 30,
): AgentWarning[] {
  const small = cohorts.filter((c) => c.n >= 5 && c.n < threshold);
  if (small.length === 0) return [];
  return [
    {
      code: 'sample_size_low',
      message: `${small.length} cohort(s) have n < ${threshold}; results may be unreliable: ${small
        .map((s) => `${s.name} (n=${s.n})`)
        .join(', ')}`,
    },
  ];
}
