import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import {
  AnomalyType,
  AnomalySeverity,
  Prisma,
  type PayrollLineItem,
} from '@compensation/database';

type Decimal = Prisma.Decimal;

// ─── Types ──────────────────────────────────────────────────

export interface AnomalyDetail {
  message: string;
  component?: string;
  amount?: number;
  previousAmount?: number;
  threshold?: number;
  suggestedAction: string;
}

export interface DetectedAnomaly {
  employeeId: string;
  anomalyType: AnomalyType;
  severity: AnomalySeverity;
  details: AnomalyDetail;
}

export interface AnomalyReport {
  payrollRunId: string;
  totalLineItems: number;
  totalAnomalies: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  anomalies: DetectedAnomaly[];
  hasBlockers: boolean;
  summary: string;
}

interface EmployeeBaseline {
  employeeId: string;
  avgGross: number;
  avgNet: number;
  stdDevGross: number;
  stdDevNet: number;
  componentAverages: Map<string, number>;
  componentStdDevs: Map<string, number>;
  periodCount: number;
}

interface LineItemGroup {
  employeeId: string;
  items: PayrollLineItem[];
  grossPay: number;
  netPay: number;
  deductions: number;
}

// ─── Configuration ──────────────────────────────────────────

const DEFAULT_CONFIG = {
  /** Max deduction as percentage of gross (0-1) */
  maxDeductionPct: 0.60,
  /** Month-on-month spike threshold (percentage change) */
  spikeThresholdPct: 0.50,
  /** Month-on-month drop threshold (percentage change) */
  dropThresholdPct: 0.30,
  /** Number of historical periods for baseline */
  baselinePeriods: 6,
  /** Minimum periods needed to compute baseline */
  minBaselinePeriods: 3,
  /** Standard deviations for statistical outlier detection */
  outlierStdDevs: 2.5,
  /** Batch size for processing line items */
  batchSize: 5000,
  /** Mandatory payroll components (at least one must be present) */
  mandatoryComponents: ['BASE_PAY', 'BASIC_SALARY', 'BASE_SALARY', 'SALARY'],
  /** Deduction component prefixes */
  deductionPrefixes: ['TAX', 'DEDUCTION', 'INSURANCE', 'PENSION', 'CONTRIBUTION'],
  /** Per-component amount thresholds (component -> max amount) */
  componentThresholds: new Map<string, number>(),
};

export type AnomalyDetectorConfig = Partial<typeof DEFAULT_CONFIG>;

// ─── Chunk helper ───────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Service ────────────────────────────────────────────────

@Injectable()
export class AnomalyDetectorService {
  private readonly logger = new Logger(AnomalyDetectorService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Run full anomaly detection on a payroll run.
   * Handles 50k+ line items by processing in batches.
   */
  async detectAnomalies(
    payrollRunId: string,
    tenantId: string,
    config: AnomalyDetectorConfig = {},
  ): Promise<AnomalyReport> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();

    this.logger.log(`Starting anomaly detection for payroll run ${payrollRunId}`);

    // 1. Load payroll run
    const payrollRun = await this.db.client.payrollRun.findFirst({
      where: { id: payrollRunId, tenantId },
    });
    if (!payrollRun) {
      throw new Error(`PayrollRun ${payrollRunId} not found for tenant ${tenantId}`);
    }

    // 2. Load line items in batches for memory efficiency
    const lineItems = await this.loadLineItemsBatched(payrollRunId, cfg.batchSize);
    this.logger.log(`Loaded ${lineItems.length} line items`);

    // 3. Group by employee
    const employeeGroups = this.groupByEmployee(lineItems);

    // 4. Build statistical baselines from historical data
    const employeeIds = Array.from(employeeGroups.keys());
    const baselines = await this.buildBaselines(
      tenantId,
      payrollRunId,
      employeeIds,
      cfg.baselinePeriods,
      cfg.minBaselinePeriods,
    );

    // 5. Run all anomaly detectors
    const anomalies: DetectedAnomaly[] = [];

    for (const [employeeId, group] of employeeGroups) {
      const baseline = baselines.get(employeeId);
      anomalies.push(
        ...this.detectNegativeNetPay(group),
        ...this.detectUnusualDeductions(group, cfg),
        ...this.detectMissingComponents(group, cfg),
        ...this.detectDuplicates(group),
        ...this.detectSpikesAndDrops(group, baseline, cfg),
        ...this.detectThresholdExceedances(group, cfg),
      );
    }

    // 6. Detect currency mismatches across the run
    anomalies.push(...await this.detectCurrencyMismatches(payrollRunId, tenantId));

    // 7. Persist anomalies to DB
    await this.persistAnomalies(payrollRunId, anomalies);

    // 8. Build report
    const criticalCount = anomalies.filter((a) => a.severity === AnomalySeverity.CRITICAL).length;
    const highCount = anomalies.filter((a) => a.severity === AnomalySeverity.HIGH).length;
    const mediumCount = anomalies.filter((a) => a.severity === AnomalySeverity.MEDIUM).length;
    const lowCount = anomalies.filter((a) => a.severity === AnomalySeverity.LOW).length;

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Anomaly detection complete: ${anomalies.length} anomalies found in ${elapsed}ms`,
    );

    const report: AnomalyReport = {
      payrollRunId,
      totalLineItems: lineItems.length,
      totalAnomalies: anomalies.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      anomalies,
      hasBlockers: criticalCount > 0,
      summary: this.buildSummary(anomalies, lineItems.length, employeeGroups.size),
    };

    return report;
  }

  // ─── Data Loading ───────────────────────────────────────────

  private async loadLineItemsBatched(
    payrollRunId: string,
    batchSize: number,
  ): Promise<PayrollLineItem[]> {
    const allItems: PayrollLineItem[] = [];
    let skip = 0;

    while (true) {
      const batch = await this.db.client.payrollLineItem.findMany({
        where: { payrollRunId },
        skip,
        take: batchSize,
        orderBy: { employeeId: 'asc' },
      });

      allItems.push(...batch);

      if (batch.length < batchSize) break;
      skip += batchSize;
    }

    return allItems;
  }

  private groupByEmployee(lineItems: PayrollLineItem[]): Map<string, LineItemGroup> {
    const groups = new Map<string, LineItemGroup>();

    for (const item of lineItems) {
      let group = groups.get(item.employeeId);
      if (!group) {
        group = {
          employeeId: item.employeeId,
          items: [],
          grossPay: 0,
          netPay: 0,
          deductions: 0,
        };
        groups.set(item.employeeId, group);
      }

      group.items.push(item);
      const amount = this.toNumber(item.amount);

      if (this.isDeduction(item.component)) {
        group.deductions += Math.abs(amount);
        group.netPay -= Math.abs(amount);
      } else {
        group.grossPay += amount;
        group.netPay += amount;
      }
    }

    return groups;
  }

  // ─── Baseline Computation ─────────────────────────────────

  private async buildBaselines(
    tenantId: string,
    currentRunId: string,
    employeeIds: string[],
    periods: number,
    minPeriods: number,
  ): Promise<Map<string, EmployeeBaseline>> {
    const baselines = new Map<string, EmployeeBaseline>();

    if (employeeIds.length === 0) return baselines;

    // Get recent payroll runs for this tenant (excluding current)
    const recentRuns = await this.db.client.payrollRun.findMany({
      where: {
        tenantId,
        id: { not: currentRunId },
        status: { in: ['APPROVED', 'FINALIZED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: periods,
      select: { id: true },
    });

    if (recentRuns.length < minPeriods) {
      this.logger.log(
        `Only ${recentRuns.length} historical periods found (need ${minPeriods}), skipping baseline`,
      );
      return baselines;
    }

    const runIds = recentRuns.map((r) => r.id);

    // Process employee baselines in chunks to avoid huge queries
    const employeeChunks = chunk(employeeIds, 500);

    for (const empChunk of employeeChunks) {
      const historicalItems = await this.db.client.payrollLineItem.findMany({
        where: {
          payrollRunId: { in: runIds },
          employeeId: { in: empChunk },
        },
        orderBy: [{ employeeId: 'asc' }, { payrollRunId: 'asc' }],
      });

      // Group historical items by employee, then by run
      const empRunMap = new Map<string, Map<string, PayrollLineItem[]>>();
      for (const item of historicalItems) {
        let runMap = empRunMap.get(item.employeeId);
        if (!runMap) {
          runMap = new Map();
          empRunMap.set(item.employeeId, runMap);
        }
        let items = runMap.get(item.payrollRunId);
        if (!items) {
          items = [];
          runMap.set(item.payrollRunId, items);
        }
        items.push(item);
      }

      // Compute baselines
      for (const [empId, runMap] of empRunMap) {
        if (runMap.size < minPeriods) continue;

        const grossValues: number[] = [];
        const netValues: number[] = [];
        const componentValues = new Map<string, number[]>();

        for (const [, items] of runMap) {
          let gross = 0;
          let net = 0;
          for (const item of items) {
            const amt = this.toNumber(item.amount);
            if (this.isDeduction(item.component)) {
              net -= Math.abs(amt);
            } else {
              gross += amt;
              net += amt;
            }

            const compKey = item.component.toUpperCase();
            if (!componentValues.has(compKey)) {
              componentValues.set(compKey, []);
            }
            componentValues.get(compKey)!.push(amt);
          }
          grossValues.push(gross);
          netValues.push(net);
        }

        const avgGross = this.mean(grossValues);
        const avgNet = this.mean(netValues);
        const stdDevGross = this.stdDev(grossValues);
        const stdDevNet = this.stdDev(netValues);

        const componentAverages = new Map<string, number>();
        const componentStdDevs = new Map<string, number>();
        for (const [comp, vals] of componentValues) {
          componentAverages.set(comp, this.mean(vals));
          componentStdDevs.set(comp, this.stdDev(vals));
        }

        baselines.set(empId, {
          employeeId: empId,
          avgGross,
          avgNet,
          stdDevGross,
          stdDevNet,
          componentAverages,
          componentStdDevs,
          periodCount: runMap.size,
        });
      }
    }

    this.logger.log(`Built baselines for ${baselines.size} employees`);
    return baselines;
  }

  // ─── Anomaly Detectors ────────────────────────────────────

  private detectNegativeNetPay(group: LineItemGroup): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];

    if (group.netPay < 0) {
      anomalies.push({
        employeeId: group.employeeId,
        anomalyType: AnomalyType.NEGATIVE_NET,
        severity: AnomalySeverity.CRITICAL,
        details: {
          message: `Negative net pay: ${group.netPay.toFixed(2)}. Gross: ${group.grossPay.toFixed(2)}, Deductions: ${group.deductions.toFixed(2)}`,
          amount: group.netPay,
          suggestedAction: 'Review deductions — total deductions exceed gross pay. Block payroll for this employee until resolved.',
        },
      });
    }

    return anomalies;
  }

  private detectUnusualDeductions(
    group: LineItemGroup,
    cfg: typeof DEFAULT_CONFIG,
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];

    if (group.grossPay <= 0) return anomalies;

    const deductionPct = group.deductions / group.grossPay;

    if (deductionPct > cfg.maxDeductionPct) {
      anomalies.push({
        employeeId: group.employeeId,
        anomalyType: AnomalyType.UNUSUAL_DEDUCTION,
        severity: deductionPct > 0.80 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
        details: {
          message: `Deductions are ${(deductionPct * 100).toFixed(1)}% of gross pay (threshold: ${(cfg.maxDeductionPct * 100).toFixed(1)}%)`,
          amount: group.deductions,
          threshold: cfg.maxDeductionPct,
          suggestedAction: 'Verify deduction amounts are correct. Check for duplicate or erroneous deduction entries.',
        },
      });
    }

    return anomalies;
  }

  private detectMissingComponents(
    group: LineItemGroup,
    cfg: typeof DEFAULT_CONFIG,
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];

    const componentNames = group.items.map((i) => i.component.toUpperCase());
    const hasMandatory = cfg.mandatoryComponents.some((mc) =>
      componentNames.some((cn) => cn.includes(mc)),
    );

    if (!hasMandatory) {
      anomalies.push({
        employeeId: group.employeeId,
        anomalyType: AnomalyType.MISSING_COMPONENT,
        severity: AnomalySeverity.HIGH,
        details: {
          message: `No mandatory base pay component found. Expected one of: ${cfg.mandatoryComponents.join(', ')}`,
          suggestedAction: 'Add base pay component for this employee or verify they are on leave/terminated.',
        },
      });
    }

    // Check for zero base pay
    for (const item of group.items) {
      const upper = item.component.toUpperCase();
      if (
        cfg.mandatoryComponents.some((mc) => upper.includes(mc)) &&
        this.toNumber(item.amount) === 0
      ) {
        anomalies.push({
          employeeId: group.employeeId,
          anomalyType: AnomalyType.MISSING_COMPONENT,
          severity: AnomalySeverity.HIGH,
          details: {
            message: `Base pay component "${item.component}" has zero amount`,
            component: item.component,
            amount: 0,
            suggestedAction: 'Verify base salary is correct. Zero base pay may indicate a data entry error.',
          },
        });
      }
    }

    return anomalies;
  }

  private detectDuplicates(group: LineItemGroup): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];
    const seen = new Map<string, PayrollLineItem>();

    for (const item of group.items) {
      const key = `${item.employeeId}:${item.component.toUpperCase()}`;
      const existing = seen.get(key);

      if (existing) {
        anomalies.push({
          employeeId: group.employeeId,
          anomalyType: AnomalyType.DUPLICATE,
          severity: AnomalySeverity.HIGH,
          details: {
            message: `Duplicate component "${item.component}" for employee. Amounts: ${this.toNumber(existing.amount).toFixed(2)} and ${this.toNumber(item.amount).toFixed(2)}`,
            component: item.component,
            amount: this.toNumber(item.amount),
            previousAmount: this.toNumber(existing.amount),
            suggestedAction: 'Remove duplicate entry or verify both entries are intentional (e.g., split payments).',
          },
        });
      } else {
        seen.set(key, item);
      }
    }

    return anomalies;
  }

  private detectSpikesAndDrops(
    group: LineItemGroup,
    baseline: EmployeeBaseline | undefined,
    cfg: typeof DEFAULT_CONFIG,
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];

    // Method 1: Use previousAmount from line items (month-on-month)
    for (const item of group.items) {
      const current = this.toNumber(item.amount);
      const previous = this.toNumber(item.previousAmount);

      if (previous !== 0) {
        const changePct = Math.abs(current - previous) / Math.abs(previous);

        if (current > previous && changePct > cfg.spikeThresholdPct) {
          anomalies.push({
            employeeId: group.employeeId,
            anomalyType: AnomalyType.SPIKE,
            severity: changePct > 1.0 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
            details: {
              message: `${item.component} spiked ${(changePct * 100).toFixed(1)}% from ${previous.toFixed(2)} to ${current.toFixed(2)}`,
              component: item.component,
              amount: current,
              previousAmount: previous,
              threshold: cfg.spikeThresholdPct,
              suggestedAction: 'Verify the increase is expected (promotion, raise, bonus). Review approval records.',
            },
          });
        } else if (current < previous && changePct > cfg.dropThresholdPct) {
          anomalies.push({
            employeeId: group.employeeId,
            anomalyType: AnomalyType.DROP,
            severity: changePct > 0.80 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
            details: {
              message: `${item.component} dropped ${(changePct * 100).toFixed(1)}% from ${previous.toFixed(2)} to ${current.toFixed(2)}`,
              component: item.component,
              amount: current,
              previousAmount: previous,
              threshold: cfg.dropThresholdPct,
              suggestedAction: 'Verify the decrease is expected (demotion, part-time change, correction).',
            },
          });
        }
      }
    }

    // Method 2: Statistical baseline comparison
    if (baseline && baseline.periodCount >= 3) {
      // Check gross pay against baseline
      if (baseline.stdDevGross > 0) {
        const zScore = Math.abs(group.grossPay - baseline.avgGross) / baseline.stdDevGross;
        if (zScore > cfg.outlierStdDevs) {
          const direction = group.grossPay > baseline.avgGross ? 'above' : 'below';
          anomalies.push({
            employeeId: group.employeeId,
            anomalyType: group.grossPay > baseline.avgGross ? AnomalyType.SPIKE : AnomalyType.DROP,
            severity: zScore > 4 ? AnomalySeverity.HIGH : AnomalySeverity.MEDIUM,
            details: {
              message: `Gross pay ${group.grossPay.toFixed(2)} is ${zScore.toFixed(1)} std devs ${direction} baseline avg ${baseline.avgGross.toFixed(2)} (σ=${baseline.stdDevGross.toFixed(2)}, ${baseline.periodCount} periods)`,
              amount: group.grossPay,
              previousAmount: baseline.avgGross,
              threshold: cfg.outlierStdDevs,
              suggestedAction: `Review gross pay — statistically unusual compared to last ${baseline.periodCount} periods.`,
            },
          });
        }
      }

      // Check individual components against baseline
      for (const item of group.items) {
        const compKey = item.component.toUpperCase();
        const compAvg = baseline.componentAverages.get(compKey);
        const compStdDev = baseline.componentStdDevs.get(compKey);

        if (compAvg !== undefined && compStdDev !== undefined && compStdDev > 0) {
          const amount = this.toNumber(item.amount);
          const zScore = Math.abs(amount - compAvg) / compStdDev;

          if (zScore > cfg.outlierStdDevs) {
            const direction = amount > compAvg ? 'above' : 'below';
            anomalies.push({
              employeeId: group.employeeId,
              anomalyType: amount > compAvg ? AnomalyType.SPIKE : AnomalyType.DROP,
              severity: AnomalySeverity.LOW,
              details: {
                message: `${item.component} amount ${amount.toFixed(2)} is ${zScore.toFixed(1)} std devs ${direction} baseline avg ${compAvg.toFixed(2)}`,
                component: item.component,
                amount,
                previousAmount: compAvg,
                threshold: cfg.outlierStdDevs,
                suggestedAction: `Review ${item.component} — statistically unusual.`,
              },
            });
          }
        }
      }
    }

    return anomalies;
  }

  private detectThresholdExceedances(
    group: LineItemGroup,
    cfg: typeof DEFAULT_CONFIG,
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];

    if (cfg.componentThresholds.size === 0) return anomalies;

    for (const item of group.items) {
      const compKey = item.component.toUpperCase();
      const threshold = cfg.componentThresholds.get(compKey);

      if (threshold !== undefined) {
        const amount = this.toNumber(item.amount);
        if (Math.abs(amount) > threshold) {
          anomalies.push({
            employeeId: group.employeeId,
            anomalyType: AnomalyType.CUSTOM,
            severity: AnomalySeverity.HIGH,
            details: {
              message: `${item.component} amount ${amount.toFixed(2)} exceeds configured threshold ${threshold.toFixed(2)}`,
              component: item.component,
              amount,
              threshold,
              suggestedAction: `Review ${item.component} — exceeds maximum allowed amount.`,
            },
          });
        }
      }
    }

    return anomalies;
  }

  private async detectCurrencyMismatches(
    payrollRunId: string,
    tenantId: string,
  ): Promise<DetectedAnomaly[]> {
    const anomalies: DetectedAnomaly[] = [];

    // Get all employees in this payroll run with their currencies
    const employeesInRun = await this.db.client.payrollLineItem.findMany({
      where: { payrollRunId },
      select: { employeeId: true },
      distinct: ['employeeId'],
    });

    if (employeesInRun.length === 0) return anomalies;

    const employeeIds = employeesInRun.map((e) => e.employeeId);

    // Load employee currency info in chunks
    const empChunks = chunk(employeeIds, 500);
    const currencyMap = new Map<string, string>();

    for (const empChunk of empChunks) {
      const employees = await this.db.client.employee.findMany({
        where: { id: { in: empChunk }, tenantId },
        select: { id: true, currency: true },
      });
      for (const emp of employees) {
        currencyMap.set(emp.id, emp.currency);
      }
    }

    // Check for mixed currencies
    const currencies = new Set(currencyMap.values());
    if (currencies.size > 1) {
      // Find the dominant currency
      const currencyCounts = new Map<string, number>();
      for (const curr of currencyMap.values()) {
        currencyCounts.set(curr, (currencyCounts.get(curr) ?? 0) + 1);
      }
      let dominantCurrency = 'USD';
      let maxCount = 0;
      for (const [curr, count] of currencyCounts) {
        if (count > maxCount) {
          dominantCurrency = curr;
          maxCount = count;
        }
      }

      // Flag employees with non-dominant currency
      for (const [empId, currency] of currencyMap) {
        if (currency !== dominantCurrency) {
          anomalies.push({
            employeeId: empId,
            anomalyType: AnomalyType.CUSTOM,
            severity: AnomalySeverity.MEDIUM,
            details: {
              message: `Employee currency (${currency}) differs from payroll run dominant currency (${dominantCurrency})`,
              suggestedAction: 'Verify currency conversion has been applied or process in separate payroll run.',
            },
          });
        }
      }
    }

    return anomalies;
  }

  // ─── Persistence ──────────────────────────────────────────

  private async persistAnomalies(
    payrollRunId: string,
    anomalies: DetectedAnomaly[],
  ): Promise<void> {
    if (anomalies.length === 0) return;

    // Clear previous anomalies for this run
    await this.db.client.payrollAnomaly.deleteMany({
      where: { payrollRunId },
    });

    // Insert in batches
    const batches = chunk(anomalies, 1000);
    for (const batch of batches) {
      await this.db.client.payrollAnomaly.createMany({
        data: batch.map((a) => ({
          payrollRunId,
          employeeId: a.employeeId,
          anomalyType: a.anomalyType,
          severity: a.severity,
          details: a.details as unknown as Prisma.InputJsonValue,
        })),
      });
    }

    this.logger.log(`Persisted ${anomalies.length} anomalies for run ${payrollRunId}`);
  }

  // ─── Helpers ──────────────────────────────────────────────

  private toNumber(value: Decimal | number | string): number {
    if (typeof value === 'number') return value;
    return Number(value);
  }

  private isDeduction(component: string): boolean {
    const upper = component.toUpperCase();
    return DEFAULT_CONFIG.deductionPrefixes.some((prefix) => upper.startsWith(prefix));
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private stdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const avg = this.mean(values);
    const squaredDiffs = values.map((v) => (v - avg) ** 2);
    return Math.sqrt(squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1));
  }

  private buildSummary(
    anomalies: DetectedAnomaly[],
    totalLineItems: number,
    totalEmployees: number,
  ): string {
    if (anomalies.length === 0) {
      return `No anomalies detected across ${totalLineItems} line items for ${totalEmployees} employees.`;
    }

    const critical = anomalies.filter((a) => a.severity === AnomalySeverity.CRITICAL).length;
    const high = anomalies.filter((a) => a.severity === AnomalySeverity.HIGH).length;
    const affectedEmployees = new Set(anomalies.map((a) => a.employeeId)).size;

    const parts = [`Found ${anomalies.length} anomalies affecting ${affectedEmployees} of ${totalEmployees} employees.`];

    if (critical > 0) {
      parts.push(`⛔ ${critical} CRITICAL issue(s) blocking payroll.`);
    }
    if (high > 0) {
      parts.push(`⚠️ ${high} HIGH severity issue(s) requiring review.`);
    }

    return parts.join(' ');
  }
}

