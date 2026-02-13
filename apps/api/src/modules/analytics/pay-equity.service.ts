import { Injectable, Logger } from '@nestjs/common';

/* ─── Types ─────────────────────────────────────────────── */

export interface PayEquityAnalysisRequest {
  dimensions: string[]; // e.g. ['gender', 'ethnicity', 'age_band']
  controlVariables?: string[]; // e.g. ['job_level', 'tenure', 'performance', 'location', 'department']
  targetThreshold?: number; // max acceptable gap % (default 2)
}

export interface RegressionResult {
  dimension: string;
  group: string;
  referenceGroup: string;
  coefficient: number;
  standardError: number;
  tStatistic: number;
  pValue: number;
  confidenceInterval: [number, number];
  sampleSize: number;
  gapPercent: number;
  significance: 'significant' | 'marginal' | 'not_significant';
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface CompaRatioResult {
  dimension: string;
  group: string;
  avgCompaRatio: number;
  medianCompaRatio: number;
  minCompaRatio: number;
  maxCompaRatio: number;
  count: number;
  stdDev: number;
}

export interface RemediationEstimate {
  totalCost: number;
  affectedEmployees: number;
  avgAdjustment: number;
  adjustmentsByGroup: Array<{
    dimension: string;
    group: string;
    employees: number;
    totalCost: number;
    avgAdjustment: number;
  }>;
}

export interface PayEquityReport {
  id: string;
  tenantId: string;
  createdAt: string;
  dimensions: string[];
  controlVariables: string[];
  overallStats: {
    totalEmployees: number;
    rSquared: number;
    adjustedRSquared: number;
    fStatistic: number;
  };
  regressionResults: RegressionResult[];
  compaRatios: CompaRatioResult[];
  remediation: RemediationEstimate;
  narrative?: string;
  status: 'pending' | 'complete' | 'error';
}

/* ─── Mock Employee Data for Analysis ───────────────────── */

interface MockEmployee {
  id: string;
  salary: number;
  gender: string;
  ethnicity: string;
  ageBand: string;
  jobLevel: number;
  tenure: number;
  performance: number;
  location: string;
  department: string;
  midpoint: number;
}

function generateMockEmployees(tenantId: string): MockEmployee[] {
  const rng = seedRandom(tenantId);
  const genders = ['Male', 'Female', 'Non-Binary'];
  const ethnicities = ['White', 'Asian', 'Black', 'Hispanic', 'Other'];
  const ageBands = ['20-29', '30-39', '40-49', '50-59', '60+'];
  const locations = ['New York', 'San Francisco', 'Chicago', 'Austin', 'Remote'];
  const departments = ['Engineering', 'Sales', 'Marketing', 'Finance', 'HR', 'Operations'];
  const employees: MockEmployee[] = [];

  for (let i = 0; i < 500; i++) {
    const jobLevel = Math.floor(rng() * 5) + 1;
    const tenure = Math.floor(rng() * 15);
    const performance = Math.floor(rng() * 5) + 1;
    const gender = genders[Math.floor(rng() * genders.length)]!;
    const ethnicity = ethnicities[Math.floor(rng() * ethnicities.length)]!;
    const baseSalary = 50000 + jobLevel * 20000 + tenure * 1500 + performance * 3000;
    // Introduce systematic gaps for demo
    const genderAdj = gender === 'Female' ? -0.04 : gender === 'Non-Binary' ? -0.02 : 0;
    const ethAdj = ethnicity === 'Black' ? -0.03 : ethnicity === 'Hispanic' ? -0.025 : 0;
    const noise = (rng() - 0.5) * 0.15;
    const salary = Math.round(baseSalary * (1 + genderAdj + ethAdj + noise));
    const midpoint = 50000 + jobLevel * 20000;

    employees.push({
      id: `emp-${i}`,
      salary,
      gender,
      ethnicity,
      ageBand: ageBands[Math.floor(rng() * ageBands.length)]!,
      jobLevel,
      tenure,
      performance,
      location: locations[Math.floor(rng() * locations.length)]!,
      department: departments[Math.floor(rng() * departments.length)]!,
      midpoint,
    });
  }
  return employees;
}

function seedRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  };
}

/* ─── Statistical Helpers ───────────────────────────────── */

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}


/**
 * Simple OLS regression for pay equity analysis.
 * Returns coefficient, standard error, t-statistic, and approximate p-value
 * for a binary group indicator controlling for numeric covariates.
 */
function olsRegression(
  salaries: number[],
  groupIndicator: number[],
  controls: number[][],
): { coefficient: number; standardError: number; tStatistic: number; pValue: number; rSquared: number } {
  const n = salaries.length;
  if (n < 10) {
    return { coefficient: 0, standardError: 0, tStatistic: 0, pValue: 1, rSquared: 0 };
  }

  // Build X matrix: [1, groupIndicator, ...controls]
  const k = 2 + controls.length; // intercept + group + controls
  const X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [1, groupIndicator[i]!];
    for (const ctrl of controls) {
      row.push(ctrl[i]!);
    }
    X.push(row);
  }

  // X'X
  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0) as number[]);
  const XtY: number[] = Array(k).fill(0) as number[];

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      XtY[j] = (XtY[j] ?? 0) + X[i]![j]! * salaries[i]!;
      for (let l = 0; l < k; l++) {
        XtX[j]![l] = (XtX[j]![l] ?? 0) + X[i]![j]! * X[i]![l]!;
      }
    }
  }

  // Solve via Gaussian elimination
  const augmented = XtX.map((row, i) => [...row, XtY[i]!]);
  for (let col = 0; col < k; col++) {
    let maxRow = col;
    for (let row = col + 1; row < k; row++) {
      if (Math.abs(augmented[row]![col]!) > Math.abs(augmented[maxRow]![col]!)) {
        maxRow = row;
      }
    }
    [augmented[col], augmented[maxRow]] = [augmented[maxRow]!, augmented[col]!];

    const pivot = augmented[col]![col]!;
    if (Math.abs(pivot) < 1e-12) {
      return { coefficient: 0, standardError: 0, tStatistic: 0, pValue: 1, rSquared: 0 };
    }

    for (let j = col; j <= k; j++) {
      augmented[col]![j]! /= pivot;
    }
    for (let row = 0; row < k; row++) {
      if (row !== col) {
        const factor = augmented[row]![col]!;
        for (let j = col; j <= k; j++) {
          augmented[row]![j]! -= factor * augmented[col]![j]!;
        }
      }
    }
  }

  const beta = augmented.map((row) => row[k]!);
  const coefficient = beta[1]!; // group indicator coefficient

  // Residuals and R²
  const yMean = mean(salaries);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    let predicted = 0;
    for (let j = 0; j < k; j++) {
      predicted += X[i]![j]! * beta[j]!;
    }
    ssRes += (salaries[i]! - predicted) ** 2;
    ssTot += (salaries[i]! - yMean) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // Standard error of coefficient
  const mse = ssRes / (n - k);

  // Invert X'X for variance-covariance (reuse augmented for inverse)
  const identity = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)),
  );
  const aug2 = XtX.map((row, i) => [...row, ...identity[i]!]);
  for (let col = 0; col < k; col++) {
    let maxRow = col;
    for (let row = col + 1; row < k; row++) {
      if (Math.abs(aug2[row]![col]!) > Math.abs(aug2[maxRow]![col]!)) {
        maxRow = row;
      }
    }
    [aug2[col], aug2[maxRow]] = [aug2[maxRow]!, aug2[col]!];
    const pivot = aug2[col]![col]!;
    if (Math.abs(pivot) < 1e-12) {
      return { coefficient, standardError: 0, tStatistic: 0, pValue: 1, rSquared };
    }
    for (let j = 0; j < 2 * k; j++) aug2[col]![j]! /= pivot;
    for (let row = 0; row < k; row++) {
      if (row !== col) {
        const factor = aug2[row]![col]!;
        for (let j = 0; j < 2 * k; j++) aug2[row]![j]! -= factor * aug2[col]![j]!;
      }
    }
  }
  const varBeta1 = mse * aug2[1]![k + 1]!;
  const se = Math.sqrt(Math.max(0, varBeta1));
  const tStat = se > 0 ? coefficient / se : 0;

  // Approximate p-value using t-distribution approximation
  const df = n - k;
  const pValue = approximatePValue(Math.abs(tStat), df);

  return { coefficient, standardError: se, tStatistic: tStat, pValue, rSquared };
}

/**
 * Approximate two-tailed p-value from t-distribution using normal approximation
 * for large df, and a better approximation for small df.
 */
function approximatePValue(t: number, df: number): number {
  if (df <= 0 || !isFinite(t)) return 1;
  // Use normal approximation for large df
  const x = t * (1 - 1 / (4 * df)) / Math.sqrt(1 + t * t / (2 * df));
  // Standard normal CDF approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const tVal = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * tVal + a4) * tVal) + a3) * tVal + a2) * tVal + a1) * tVal * Math.exp(-absX * absX / 2);
  const cdf = 0.5 * (1 + sign * y);
  return 2 * (1 - cdf); // two-tailed
}
function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/* ─── Service ───────────────────────────────────────────── */

// In-memory report store (production would use DB)
const reportStore = new Map<string, PayEquityReport>();

@Injectable()
export class PayEquityService {
  private readonly logger = new Logger(PayEquityService.name);

  /**
   * Run pay equity analysis for a tenant.
   */
  async analyze(
    tenantId: string,
    userId: string,
    request: PayEquityAnalysisRequest,
  ): Promise<PayEquityReport> {
    this.logger.log(
      `Pay equity analysis: tenant=${tenantId} user=${userId} dimensions=${request.dimensions.join(',')}`,
    );

    const employees = generateMockEmployees(tenantId);
    const controlVars = request.controlVariables ?? [
      'job_level', 'tenure', 'performance', 'location', 'department',
    ];
    const threshold = request.targetThreshold ?? 2;

    // Run regression for each dimension/group
    const regressionResults: RegressionResult[] = [];
    let overallRSquared = 0;
    let regressionCount = 0;

    for (const dimension of request.dimensions) {
      const groups = this.getGroups(employees, dimension);
      const referenceGroup = groups[0]!;

      for (const group of groups.slice(1)) {
        const result = this.runGroupRegression(
          employees, dimension, group, referenceGroup, controlVars,
        );
        regressionResults.push(result);
        overallRSquared += result.coefficient !== 0 ? this.getRSquared(employees, dimension, group, referenceGroup, controlVars) : 0;
        regressionCount++;
      }
    }

    // Compa-ratio analysis
    const compaRatios = this.calculateCompaRatios(employees, request.dimensions);

    // Remediation estimate
    const remediation = this.calculateRemediation(employees, regressionResults, threshold);

    // Overall stats
    const avgRSquared = regressionCount > 0 ? overallRSquared / regressionCount : 0;
    const overallStats = {
      totalEmployees: employees.length,
      rSquared: Math.round(avgRSquared * 1000) / 1000,
      adjustedRSquared: Math.round((avgRSquared - (1 - avgRSquared) * (controlVars.length / (employees.length - controlVars.length - 1))) * 1000) / 1000,
      fStatistic: Math.round((avgRSquared / (1 - avgRSquared)) * ((employees.length - controlVars.length - 1) / controlVars.length) * 100) / 100,
    };

    const reportId = `peq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const report: PayEquityReport = {
      id: reportId,
      tenantId,
      createdAt: new Date().toISOString(),
      dimensions: request.dimensions,
      controlVariables: controlVars,
      overallStats,
      regressionResults,
      compaRatios,
      remediation,
      status: 'complete',
    };

    reportStore.set(reportId, report);
    return report;
  }

  /**
   * Get a previously generated report by ID.
   */
  async getReport(tenantId: string, reportId: string): Promise<PayEquityReport | null> {
    const report = reportStore.get(reportId);
    if (!report || report.tenantId !== tenantId) return null;
    return report;
  }

  /**
   * Simulate remediation: "What if we raise underpaid group by X%?"
   */
  async simulateRemediation(
    tenantId: string,
    reportId: string,
    adjustmentPercent: number,
    targetGroups?: Array<{ dimension: string; group: string }>,
  ): Promise<{
    originalCost: number;
    newCost: number;
    savings: number;
    affectedEmployees: number;
    newGapEstimates: Array<{ dimension: string; group: string; estimatedNewGap: number }>;
  }> {
    const report = reportStore.get(reportId);
    if (!report || report.tenantId !== tenantId) {
      return { originalCost: 0, newCost: 0, savings: 0, affectedEmployees: 0, newGapEstimates: [] };
    }

    const employees = generateMockEmployees(tenantId);
    const significantGaps = report.regressionResults.filter(
      (r) => r.significance === 'significant' || r.significance === 'marginal',
    );

    const groups = targetGroups ?? significantGaps.map((r) => ({
      dimension: r.dimension,
      group: r.group,
    }));

    let totalAffected = 0;
    let totalCost = 0;
    const newGapEstimates: Array<{ dimension: string; group: string; estimatedNewGap: number }> = [];

    for (const { dimension, group } of groups) {
      const dimKey = this.getDimensionKey(dimension);
      const groupEmployees = employees.filter((e) => String(e[dimKey]) === group);
      const avgSalary = mean(groupEmployees.map((e) => e.salary));
      const adjustment = avgSalary * (adjustmentPercent / 100);
      const affected = groupEmployees.length;

      totalAffected += affected;
      totalCost += affected * adjustment;

      const originalGap = significantGaps.find(
        (r) => r.dimension === dimension && r.group === group,
      );
      const estimatedNewGap = originalGap
        ? Math.max(0, Math.abs(originalGap.gapPercent) - adjustmentPercent)
        : 0;

      newGapEstimates.push({ dimension, group, estimatedNewGap });
    }

    return {
      originalCost: report.remediation.totalCost,
      newCost: Math.round(totalCost),
      savings: Math.round(report.remediation.totalCost - totalCost),
      affectedEmployees: totalAffected,
      newGapEstimates,
    };
  }

  /* ─── Private Helpers ─────────────────────────────────── */

  private getGroups(employees: MockEmployee[], dimension: string): string[] {
    const dimKey = this.getDimensionKey(dimension);
    const counts = new Map<string, number>();
    for (const emp of employees) {
      const val = String(emp[dimKey]);
      counts.set(val, (counts.get(val) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
  }

  private getDimensionKey(dimension: string): keyof MockEmployee {
    const map: Record<string, keyof MockEmployee> = {
      gender: 'gender',
      ethnicity: 'ethnicity',
      age_band: 'ageBand',
      age: 'ageBand',
      department: 'department',
      location: 'location',
    };
    return map[dimension] ?? 'gender';
  }

  private getControlValues(emp: MockEmployee, controlVar: string): number {
    const map: Record<string, number> = {
      job_level: emp.jobLevel,
      tenure: emp.tenure,
      performance: emp.performance,
      location: ['New York', 'San Francisco', 'Chicago', 'Austin', 'Remote'].indexOf(emp.location),
      department: ['Engineering', 'Sales', 'Marketing', 'Finance', 'HR', 'Operations'].indexOf(emp.department),
    };
    return map[controlVar] ?? 0;
  }


  private runGroupRegression(
    employees: MockEmployee[],
    dimension: string,
    group: string,
    referenceGroup: string,
    controlVars: string[],
  ): RegressionResult {
    const dimKey = this.getDimensionKey(dimension);
    const relevant = employees.filter(
      (e) => String(e[dimKey]) === group || String(e[dimKey]) === referenceGroup,
    );

    const salaries = relevant.map((e) => e.salary);
    const groupIndicator = relevant.map((e) => (String(e[dimKey]) === group ? 1 : 0));
    const controls = controlVars.map((cv) => relevant.map((e) => this.getControlValues(e, cv)));

    const result = olsRegression(salaries, groupIndicator, controls);
    const avgSalary = mean(salaries);
    const gapPercent = avgSalary > 0 ? (result.coefficient / avgSalary) * 100 : 0;

    const significance: RegressionResult['significance'] =
      result.pValue < 0.05 ? 'significant' :
      result.pValue < 0.10 ? 'marginal' : 'not_significant';

    const riskLevel: RegressionResult['riskLevel'] =
      Math.abs(gapPercent) > 5 && result.pValue < 0.05 ? 'HIGH' :
      Math.abs(gapPercent) > 2 && result.pValue < 0.10 ? 'MEDIUM' : 'LOW';

    const ci: [number, number] = [
      Math.round((result.coefficient - 1.96 * result.standardError) * 100) / 100,
      Math.round((result.coefficient + 1.96 * result.standardError) * 100) / 100,
    ];

    return {
      dimension,
      group,
      referenceGroup,
      coefficient: Math.round(result.coefficient * 100) / 100,
      standardError: Math.round(result.standardError * 100) / 100,
      tStatistic: Math.round(result.tStatistic * 1000) / 1000,
      pValue: Math.round(result.pValue * 10000) / 10000,
      confidenceInterval: ci,
      sampleSize: relevant.length,
      gapPercent: Math.round(gapPercent * 100) / 100,
      significance,
      riskLevel,
    };
  }

  private getRSquared(
    employees: MockEmployee[],
    dimension: string,
    group: string,
    referenceGroup: string,
    controlVars: string[],
  ): number {
    const dimKey = this.getDimensionKey(dimension);
    const relevant = employees.filter(
      (e) => String(e[dimKey]) === group || String(e[dimKey]) === referenceGroup,
    );
    const salaries = relevant.map((e) => e.salary);
    const groupIndicator = relevant.map((e) => (String(e[dimKey]) === group ? 1 : 0));
    const controls = controlVars.map((cv) => relevant.map((e) => this.getControlValues(e, cv)));
    return olsRegression(salaries, groupIndicator, controls).rSquared;
  }

  private calculateCompaRatios(
    employees: MockEmployee[],
    dimensions: string[],
  ): CompaRatioResult[] {
    const results: CompaRatioResult[] = [];

    for (const dimension of dimensions) {
      const dimKey = this.getDimensionKey(dimension);
      const groups = new Map<string, MockEmployee[]>();

      for (const emp of employees) {
        const val = String(emp[dimKey]);
        if (!groups.has(val)) groups.set(val, []);
        groups.get(val)!.push(emp);
      }

      for (const [group, emps] of groups) {
        const ratios = emps.map((e) => e.midpoint > 0 ? e.salary / e.midpoint : 1);
        results.push({
          dimension,
          group,
          avgCompaRatio: Math.round(mean(ratios) * 1000) / 1000,
          medianCompaRatio: Math.round(median(ratios) * 1000) / 1000,
          minCompaRatio: Math.round(Math.min(...ratios) * 1000) / 1000,
          maxCompaRatio: Math.round(Math.max(...ratios) * 1000) / 1000,
          count: emps.length,
          stdDev: Math.round(stddev(ratios) * 1000) / 1000,
        });
      }
    }

    return results;
  }

  private calculateRemediation(
    employees: MockEmployee[],
    regressionResults: RegressionResult[],
    threshold: number,
  ): RemediationEstimate {
    const significantGaps = regressionResults.filter(
      (r) => (r.significance === 'significant' || r.significance === 'marginal') && Math.abs(r.gapPercent) > threshold,
    );

    let totalCost = 0;
    let totalAffected = 0;
    const adjustmentsByGroup: RemediationEstimate['adjustmentsByGroup'] = [];

    for (const gap of significantGaps) {
      const dimKey = this.getDimensionKey(gap.dimension);
      const groupEmps = employees.filter((e) => String(e[dimKey]) === gap.group);
      const avgSalary = mean(groupEmps.map((e) => e.salary));
      const adjustmentPct = Math.abs(gap.gapPercent) - threshold;
      const perEmployeeCost = Math.round(avgSalary * (adjustmentPct / 100));
      const groupCost = perEmployeeCost * groupEmps.length;

      totalCost += groupCost;
      totalAffected += groupEmps.length;

      adjustmentsByGroup.push({
        dimension: gap.dimension,
        group: gap.group,
        employees: groupEmps.length,
        totalCost: groupCost,
        avgAdjustment: perEmployeeCost,
      });
    }

    return {
      totalCost,
      affectedEmployees: totalAffected,
      avgAdjustment: totalAffected > 0 ? Math.round(totalCost / totalAffected) : 0,
      adjustmentsByGroup,
    };
  }
}