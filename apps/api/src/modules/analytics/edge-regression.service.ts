/**
 * EDGE-Compliant Pay Equity Regression Engine
 *
 * Implements the EDGE (Economic Dividends for Gender Equality) methodology:
 * - Dependent variable: ln(Salary) for Standard, ln(Pay) for Customized
 * - Mandatory predictors: Gender, Age, Age², Tenure, Function Type,
 *   Responsibility Level, People Manager indicator
 * - Gender effect: (exp(β₁) - 1) × 100
 * - Standard threshold: ±5%
 * - Customized threshold: 5% − 0.25% per additional predictor
 * - Minimum sample: 100 employees (+ 10 per extra predictor for Customized)
 */

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/* ─── Types ─────────────────────────────────────────────── */

export interface EdgeAnalysisConfig {
  type: 'STANDARD' | 'CUSTOMIZED';
  compType: 'SALARY' | 'PAY'; // SALARY = base, PAY = total cash
  name: string;
  /** Additional predictors for CUSTOMIZED analysis (beyond EDGE mandatory set) */
  additionalPredictors?: string[];
  /** Filter to a specific department/function/level for dimension analysis */
  dimensionFilters?: { type: string; value: string }[];
  /** Override threshold (default: auto-calculated per EDGE rules) */
  thresholdOverride?: number;
}

export interface EdgeEmployee {
  id: string;
  gender: string; // 'MALE' | 'FEMALE'
  baseSalary: number;
  totalCashComp: number;
  age: number; // Derived from dateOfBirth
  tenure: number; // Years since hireDate
  functionType: string; // 'CORE' | 'SUPPORT'
  responsibilityLevel: string; // 'TOP' | 'UPPER' | 'MIDDLE' | 'JUNIOR' | 'OPERATIONAL'
  isPeopleManager: boolean;
  ftePercent: number;
  department: string;
  level: string;
}

export interface EdgeCoefficient {
  name: string;
  value: number;
  standardError: number;
  tStatistic: number;
  pValue: number;
}

export interface EdgeRegressionResult {
  populationSize: number;
  maleCount: number;
  femaleCount: number;
  coefficients: EdgeCoefficient[];
  genderEffect: number; // (exp(β₁) - 1) × 100
  threshold: number;
  isCompliant: boolean;
  rSquared: number;
  adjustedRSquared: number;
  fStatistic: number;
  dimension: string;
  dimensionType: string;
}

export interface EdgeAnalysisResult {
  config: EdgeAnalysisConfig;
  overall: EdgeRegressionResult;
  dimensions: EdgeRegressionResult[];
  populationSize: number;
  snapshotDate: Date;
  errors: string[];
}

/* ─── Matrix Math (pure OLS — no external deps) ─────────── */

/** Transpose a matrix */
function transpose(M: number[][]): number[][] {
  const rows = M.length;
  const cols = M[0]!.length;
  const T: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0) as number[]);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      T[j]![i] = M[i]![j]!;
    }
  }
  return T;
}

/** Multiply two matrices */
function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const n = B[0]!.length;
  const p = B.length;
  const C: number[][] = Array.from({ length: m }, () => new Array(n).fill(0) as number[]);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < p; k++) {
        sum += A[i]![k]! * B[k]![j]!;
      }
      C[i]![j] = sum;
    }
  }
  return C;
}

/** Invert a square matrix via Gauss-Jordan elimination */
function invertMatrix(M: number[][]): number[][] | null {
  const n = M.length;
  // Augment with identity
  const aug: number[][] = M.map((row, i) => [
    ...row.map((v) => v),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row]![col]!) > Math.abs(aug[maxRow]![col]!)) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow]!, aug[col]!];

    const pivot = aug[col]![col]!;
    if (Math.abs(pivot) < 1e-12) return null; // Singular

    for (let j = 0; j < 2 * n; j++) aug[col]![j]! /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row]![col]!;
      for (let j = 0; j < 2 * n; j++) {
        aug[row]![j]! -= factor * aug[col]![j]!;
      }
    }
  }

  return aug.map((row) => row.slice(n));
}

/** Approximate two-tailed p-value from t-distribution using normal approximation */
function approxPValue(t: number, df: number): number {
  if (df <= 0) return 1;
  // Abramowitz & Stegun normal approximation for large df
  const x = (Math.abs(t) * (1 - 1 / (4 * df))) / Math.sqrt(1 + (t * t) / (2 * df));
  // Standard normal CDF approximation
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const tt = 1 / (1 + p * absX);
  const cdf =
    0.5 *
    (1 +
      sign *
        (1 -
          ((((a5 * tt + a4) * tt + a3) * tt + a2) * tt + a1) * tt * Math.exp((-absX * absX) / 2)));
  return 2 * (1 - cdf);
}

/**
 * Run OLS regression: Y = Xβ + ε
 * Returns coefficients, standard errors, t-stats, p-values, R², F-statistic.
 */
function olsRegression(
  Y: number[],
  X: number[][],
  predictorNames: string[],
): {
  coefficients: EdgeCoefficient[];
  rSquared: number;
  adjustedRSquared: number;
  fStatistic: number;
} | null {
  const n = Y.length;
  const k = X[0]!.length; // includes intercept

  if (n <= k) return null;

  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const XtXinv = invertMatrix(XtX);
  if (!XtXinv) return null;

  // β = (X'X)⁻¹ X'Y
  const Yvec = Y.map((y) => [y]);
  const XtY = matMul(Xt, Yvec);
  const betaVec = matMul(XtXinv, XtY);
  const beta = betaVec.map((row) => row[0]!);

  // Residuals and R²
  let ssRes = 0,
    ssTot = 0;
  const yMean = Y.reduce((a, b) => a + b, 0) / n;

  for (let i = 0; i < n; i++) {
    let predicted = 0;
    for (let j = 0; j < k; j++) predicted += X[i]![j]! * beta[j]!;
    ssRes += (Y[i]! - predicted) ** 2;
    ssTot += (Y[i]! - yMean) ** 2;
  }

  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const adjustedRSquared = 1 - ((1 - rSquared) * (n - 1)) / (n - k);
  const ssReg = ssTot - ssRes;
  const fStatistic = k > 1 ? ssReg / (k - 1) / (ssRes / (n - k)) : 0;

  // Standard errors from diagonal of MSE × (X'X)⁻¹
  const mse = ssRes / (n - k);
  const coefficients: EdgeCoefficient[] = [];

  for (let j = 0; j < k; j++) {
    const variance = mse * XtXinv[j]![j]!;
    const se = Math.sqrt(Math.max(0, variance));
    const tStat = se > 0 ? beta[j]! / se : 0;
    const pValue = approxPValue(tStat, n - k);

    coefficients.push({
      name: predictorNames[j]!,
      value: beta[j]!,
      standardError: se,
      tStatistic: tStat,
      pValue,
    });
  }

  return { coefficients, rSquared, adjustedRSquared, fStatistic };
}

/* ─── EDGE Encoding Helpers ─────────────────────────────── */

const RESPONSIBILITY_LEVELS = ['TOP', 'UPPER', 'MIDDLE', 'JUNIOR', 'OPERATIONAL'] as const;

/** One-hot encode a categorical variable, dropping the last category as reference */
function oneHotEncode(
  values: string[],
  categories: readonly string[],
): { columns: number[][]; names: string[] } {
  const columns: number[][] = [];
  const names: string[] = [];
  // Drop last category as reference
  for (let c = 0; c < categories.length - 1; c++) {
    const col = values.map((v) => (v === categories[c] ? 1 : 0));
    columns.push(col);
    names.push(`responsibility_${categories[c]!.toLowerCase()}`);
  }
  return { columns, names };
}

/* ─── EDGE Regression Service ───────────────────────────── */

@Injectable()
export class EdgeRegressionService {
  private readonly logger = new Logger(EdgeRegressionService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Calculate EDGE threshold based on analysis type and additional predictors.
   * Standard: ±5%
   * Customized: 5% − 0.25% per additional predictor
   */
  calculateThreshold(config: EdgeAnalysisConfig): number {
    if (config.thresholdOverride != null) return config.thresholdOverride;
    if (config.type === 'STANDARD') return 5.0;
    const extraPredictors = config.additionalPredictors?.length ?? 0;
    return Math.max(0, 5.0 - 0.25 * extraPredictors);
  }

  /**
   * Minimum required sample size per EDGE methodology.
   * Standard: 100 employees
   * Customized: 100 + 10 per additional predictor
   */
  minimumSampleSize(config: EdgeAnalysisConfig): number {
    if (config.type === 'STANDARD') return 100;
    const extraPredictors = config.additionalPredictors?.length ?? 0;
    return 100 + 10 * extraPredictors;
  }

  /**
   * Fetch employees with EDGE-required fields from the database.
   */
  async fetchEdgeEmployees(tenantId: string): Promise<EdgeEmployee[]> {
    return this.db.forTenant(tenantId, async (tx) => {
      const rows = await tx.employee.findMany({
        where: {
          tenantId,
          terminationDate: null, // Active employees only
          gender: { in: ['MALE', 'FEMALE'] }, // EDGE requires binary gender for regression
        },
        select: {
          id: true,
          gender: true,
          baseSalary: true,
          totalCashComp: true,
          dateOfBirth: true,
          hireDate: true,
          functionType: true,
          responsibilityLevel: true,
          isPeopleManager: true,
          ftePercent: true,
          department: true,
          level: true,
        },
      });

      const now = new Date();
      return rows
        .filter((r) => r.gender && r.baseSalary)
        .map((r) => {
          const dob = r.dateOfBirth ? new Date(r.dateOfBirth) : null;
          const age = dob ? (now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000) : 40; // Default age if missing
          const tenure =
            (now.getTime() - new Date(r.hireDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);

          return {
            id: r.id,
            gender: r.gender!,
            baseSalary: Number(r.baseSalary),
            totalCashComp: Number(r.totalCashComp) || Number(r.baseSalary),
            age,
            tenure: Math.max(0, tenure),
            functionType: r.functionType ?? 'SUPPORT',
            responsibilityLevel: r.responsibilityLevel ?? 'OPERATIONAL',
            isPeopleManager: r.isPeopleManager,
            ftePercent: Number(r.ftePercent),
            department: r.department,
            level: r.level,
          };
        })
        .filter((e) => e.baseSalary > 0);
    });
  }

  /**
   * Build the EDGE design matrix.
   *
   * Standard EDGE predictors:
   *   [Intercept, Gender (Female=1), Age, Age², Tenure,
   *    Function (CORE=1), Responsibility dummies, PeopleManager]
   *
   * For Customized: appends additional predictors.
   */
  buildDesignMatrix(
    employees: EdgeEmployee[],
    config: EdgeAnalysisConfig,
  ): { X: number[][]; Y: number[]; predictorNames: string[] } {
    const n = employees.length;
    const useComp = config.compType === 'PAY';

    // Dependent variable: ln(Salary) or ln(Pay)
    const Y = employees.map((e) => Math.log(useComp ? e.totalCashComp : e.baseSalary));

    // Center age for numerical stability
    const meanAge = employees.reduce((s, e) => s + e.age, 0) / n;

    // One-hot encode responsibility levels (drop OPERATIONAL as reference)
    const respEncoding = oneHotEncode(
      employees.map((e) => e.responsibilityLevel),
      RESPONSIBILITY_LEVELS,
    );

    const predictorNames = [
      'intercept',
      'gender_female',
      'age',
      'age_squared',
      'tenure',
      'function_core',
      ...respEncoding.names,
      'people_manager',
    ];

    // Build X matrix
    const X: number[][] = [];
    for (let i = 0; i < n; i++) {
      const e = employees[i]!;
      const ageCentered = e.age - meanAge;
      const row = [
        1, // intercept
        e.gender === 'FEMALE' ? 1 : 0, // gender indicator
        ageCentered, // age (centered)
        ageCentered * ageCentered, // age²
        e.tenure, // tenure in years
        e.functionType === 'CORE' ? 1 : 0, // function type
        ...respEncoding.columns.map((col) => col[i]!), // responsibility dummies
        e.isPeopleManager ? 1 : 0, // people manager indicator
      ];
      X.push(row);
    }

    // Customized: add extra predictors
    if (config.type === 'CUSTOMIZED' && config.additionalPredictors) {
      for (const pred of config.additionalPredictors) {
        if (pred === 'ftePercent') {
          predictorNames.push('fte_percent');
          for (let i = 0; i < n; i++) X[i]!.push(employees[i]!.ftePercent / 100);
        }
        // Additional predictors can be added here as needed
      }
    }

    return { X, Y, predictorNames };
  }

  /**
   * Run EDGE regression on a subset of employees for a specific dimension.
   */
  runDimensionRegression(
    employees: EdgeEmployee[],
    config: EdgeAnalysisConfig,
    dimension: string,
    dimensionType: string,
  ): EdgeRegressionResult | null {
    const maleCount = employees.filter((e) => e.gender === 'MALE').length;
    const femaleCount = employees.filter((e) => e.gender === 'FEMALE').length;

    if (employees.length < 10 || maleCount < 3 || femaleCount < 3) {
      this.logger.warn(
        `Skipping dimension ${dimension}: insufficient data (n=${employees.length}, M=${maleCount}, F=${femaleCount})`,
      );
      return null;
    }

    const { X, Y, predictorNames } = this.buildDesignMatrix(employees, config);
    const result = olsRegression(Y, X, predictorNames);

    if (!result) {
      this.logger.warn(`Regression failed for dimension ${dimension} (singular matrix)`);
      return null;
    }

    // Gender effect: (exp(β₁) - 1) × 100 where β₁ is gender_female coefficient
    const genderCoeff = result.coefficients.find((c) => c.name === 'gender_female');
    const genderEffect = genderCoeff ? (Math.exp(genderCoeff.value) - 1) * 100 : 0;
    const threshold = this.calculateThreshold(config);

    return {
      populationSize: employees.length,
      maleCount,
      femaleCount,
      coefficients: result.coefficients,
      genderEffect: Math.round(genderEffect * 1000) / 1000, // 3 decimal places
      threshold,
      isCompliant: Math.abs(genderEffect) <= threshold,
      rSquared: Math.round(result.rSquared * 10000) / 10000,
      adjustedRSquared: Math.round(result.adjustedRSquared * 10000) / 10000,
      fStatistic: Math.round(result.fStatistic * 10000) / 10000,
      dimension,
      dimensionType,
    };
  }

  /**
   * Run the full EDGE pay equity analysis for a tenant.
   */
  async analyze(tenantId: string, config: EdgeAnalysisConfig): Promise<EdgeAnalysisResult> {
    this.logger.log(
      `EDGE analysis: tenant=${tenantId} type=${config.type} comp=${config.compType}`,
    );

    const employees = await this.fetchEdgeEmployees(tenantId);
    const errors: string[] = [];
    const minSample = this.minimumSampleSize(config);

    if (employees.length < minSample) {
      errors.push(
        `Insufficient population: ${employees.length} employees found, EDGE requires minimum ${minSample}`,
      );
    }

    // Overall regression
    const overall = this.runDimensionRegression(employees, config, 'OVERALL', 'OVERALL');
    if (!overall) {
      return {
        config,
        overall: this.emptyResult('OVERALL', 'OVERALL', config),
        dimensions: [],
        populationSize: employees.length,
        snapshotDate: new Date(),
        errors: [...errors, 'Overall regression failed — insufficient data or singular matrix'],
      };
    }

    // Dimension breakdowns: by department
    const dimensions: EdgeRegressionResult[] = [];
    const departments = [...new Set(employees.map((e) => e.department))].sort();

    for (const dept of departments) {
      const deptEmployees = employees.filter((e) => e.department === dept);
      const result = this.runDimensionRegression(deptEmployees, config, dept, 'DEPARTMENT');
      if (result) dimensions.push(result);
    }

    // By function type
    for (const fn of ['CORE', 'SUPPORT']) {
      const fnEmployees = employees.filter((e) => e.functionType === fn);
      const result = this.runDimensionRegression(fnEmployees, config, fn, 'FUNCTION');
      if (result) dimensions.push(result);
    }

    // By responsibility level
    for (const level of RESPONSIBILITY_LEVELS) {
      const levelEmployees = employees.filter((e) => e.responsibilityLevel === level);
      const result = this.runDimensionRegression(levelEmployees, config, level, 'LEVEL');
      if (result) dimensions.push(result);
    }

    return {
      config,
      overall,
      dimensions,
      populationSize: employees.length,
      snapshotDate: new Date(),
      errors,
    };
  }

  /** Helper: create an empty result for failed regressions */
  private emptyResult(
    dimension: string,
    dimensionType: string,
    config: EdgeAnalysisConfig,
  ): EdgeRegressionResult {
    return {
      populationSize: 0,
      maleCount: 0,
      femaleCount: 0,
      coefficients: [],
      genderEffect: 0,
      threshold: this.calculateThreshold(config),
      isCompliant: false,
      rSquared: 0,
      adjustedRSquared: 0,
      fStatistic: 0,
      dimension,
      dimensionType,
    };
  }
}
