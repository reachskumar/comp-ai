import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@compensation/database';
import {
  buildResult,
  checkKAnonymity,
  checkSampleSize,
  type AgentWarning,
  type PayEquityAgentResult,
  type PayEquityMethodology,
} from '@compensation/ai';
import { DatabaseService } from '../../database';
import { PayEquityService as LegacyAnalyzer } from '../analytics/pay-equity.service';
import type { RunPayEquityAnalysisDto } from './dto/run-analysis.dto';
import type { ListPayEquityRunsDto } from './dto/list-runs.dto';

/**
 * Phase 1: outlier row shape returned by getOutliers.
 * Module-scope so empty + populated branches can share a single typed array.
 */
interface OutlierRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  level: string;
  compaRatio: number;
  baseSalary: number;
  currency: string;
  cohort: { dimension: string; group: string };
  gapPercent: number;
  explanation: string;
}

/**
 * Pay Equity Service (Phase 0).
 *
 * Wraps the existing analytics PayEquityService (statistical engine) with the
 * new auditor-defensible contract: every analysis produces a PayEquityRun row
 * containing the full PayEquityAgentResult<T> envelope (output, citations,
 * methodology, confidence, warnings).
 *
 * The legacy analytics endpoints continue to work unchanged. New endpoints
 * (/api/v1/pay-equity/*) are routed through this service.
 *
 * Phase 0 deliberately does not reimplement statistics; that lives in the
 * legacy service and is shared. Phase 1+ adds new agents (cohort root-cause,
 * remediation solver, projection) on top of this contract.
 */
@Injectable()
export class PayEquityV2Service {
  private readonly logger = new Logger(PayEquityV2Service.name);

  /** Frozen methodology for the narrative agent. Bump version when EDGE spec or controls change. */
  static readonly METHODOLOGY_VERSION = '2026.04';
  static readonly METHODOLOGY_NAME = 'edge-multivariate';

  constructor(
    private readonly db: DatabaseService,
    private readonly legacy: LegacyAnalyzer,
  ) {}

  /**
   * Run a Pay Equity analysis: invoke the statistical engine, build a
   * PayEquityAgentResult<T> envelope, persist as a PayEquityRun row, return.
   *
   * Doesn't yet call the LLM narrative graph — that comes in Phase 1.5. For
   * Phase 0 the goal is the contract + persistence + audit trail.
   */
  async runAnalysis(tenantId: string, userId: string, dto: RunPayEquityAnalysisDto) {
    this.logger.log(
      `Pay equity run: tenant=${tenantId} user=${userId} dims=${dto.dimensions.join(',')}`,
    );

    // Pre-create the run row so we have a runId even if statistics fail.
    const pendingRun = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.create({
        data: {
          tenantId,
          userId,
          agentType: 'narrative',
          methodologyName: PayEquityV2Service.METHODOLOGY_NAME,
          methodologyVersion: PayEquityV2Service.METHODOLOGY_VERSION,
          controls: dto.controlVariables ?? [
            'job_level',
            'tenure',
            'performance',
            'location',
            'department',
          ],
          status: 'PENDING',
          summary: dto.note ?? null,
        },
      }),
    );

    try {
      const legacyReport = await this.legacy.analyze(tenantId, userId, {
        dimensions: dto.dimensions,
        controlVariables: dto.controlVariables,
        targetThreshold: dto.targetThreshold,
      });

      // ─── Build the PayEquityAgentResult<T> envelope ──────────
      const cohorts = legacyReport.regressionResults.map((r) => ({
        name: `${r.dimension}/${r.group}`,
        n: r.sampleSize,
      }));

      const warnings: AgentWarning[] = [
        ...checkKAnonymity(cohorts, 5),
        ...checkSampleSize(cohorts, 30),
      ];

      const methodology: PayEquityMethodology = {
        name: PayEquityV2Service.METHODOLOGY_NAME,
        version: PayEquityV2Service.METHODOLOGY_VERSION,
        controls: legacyReport.controlVariables,
        dependentVariable: 'log_salary',
        sampleSize: legacyReport.overallStats.totalEmployees,
        confidenceInterval: 0.95,
        complianceThreshold: dto.targetThreshold ?? 2,
      };

      // Citations: every regression coefficient becomes a citation.
      const citations = legacyReport.regressionResults.map((r) => ({
        type: 'regression_coefficient' as const,
        ref: `${r.dimension}.${r.group}.vs.${r.referenceGroup}`,
        excerpt: `β=${r.coefficient}, p=${r.pValue}, n=${r.sampleSize}`,
      }));

      // Highest-risk dimensions go into "confidence" calculation.
      const significantGaps = legacyReport.regressionResults.filter(
        (r) => r.significance === 'significant',
      );
      const confidence: 'high' | 'medium' | 'low' =
        legacyReport.overallStats.totalEmployees > 200 && warnings.length === 0
          ? 'high'
          : warnings.some((w) => w.code === 'sample_size_low')
            ? 'low'
            : 'medium';

      const envelope: PayEquityAgentResult<typeof legacyReport> = buildResult({
        output: legacyReport,
        citations,
        methodology,
        confidence,
        warnings,
        runId: pendingRun.id,
      });

      // Audit log — we want the analytics action visible alongside other audit rows.
      const summary = significantGaps.length
        ? `${significantGaps.length} significant gap(s) across ${dto.dimensions.join(', ')}`
        : `No significant gaps across ${dto.dimensions.join(', ')}`;

      const finalRun = await this.db.forTenant(tenantId, async (tx) => {
        const updated = await tx.payEquityRun.update({
          where: { id: pendingRun.id },
          data: {
            status: 'COMPLETE',
            sampleSize: legacyReport.overallStats.totalEmployees,
            result: envelope as unknown as Prisma.InputJsonValue,
            summary,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'PAY_EQUITY_RUN',
            entityType: 'PayEquityRun',
            entityId: pendingRun.id,
            changes: {
              dimensions: dto.dimensions,
              significantGaps: significantGaps.length,
              sampleSize: legacyReport.overallStats.totalEmployees,
              methodologyVersion: PayEquityV2Service.METHODOLOGY_VERSION,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return updated;
      });

      return {
        runId: finalRun.id,
        envelope,
      };
    } catch (err) {
      this.logger.error(`Pay equity run failed for ${pendingRun.id}`, err);
      await this.db.forTenant(tenantId, (tx) =>
        tx.payEquityRun.update({
          where: { id: pendingRun.id },
          data: {
            status: 'FAILED',
            errorMsg: err instanceof Error ? err.message : 'Unknown error',
          },
        }),
      );
      throw err;
    }
  }

  async listRuns(tenantId: string, query: ListPayEquityRunsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PayEquityRunWhereInput = { tenantId };
    if (query.agentType) where.agentType = query.agentType;
    if (query.status) where.status = query.status;

    const [items, total] = await this.db.forTenant(tenantId, async (tx) => {
      const data = await tx.payEquityRun.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          agentType: true,
          methodologyName: true,
          methodologyVersion: true,
          sampleSize: true,
          status: true,
          summary: true,
          createdAt: true,
        },
      });
      const t = await tx.payEquityRun.count({ where });
      return [data, t] as const;
    });

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getRun(tenantId: string, runId: string) {
    const run = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.findFirst({ where: { id: runId, tenantId } }),
    );
    if (!run) throw new NotFoundException(`Pay equity run ${runId} not found`);
    return run;
  }

  /**
   * Compute a 4-card status summary for the workspace overview tab.
   * Returns the latest run's headline numbers + change vs the previous run
   * (if any) for trend arrows.
   */
  async getOverview(tenantId: string) {
    const runs = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.findMany({
        where: { tenantId, agentType: 'narrative', status: 'COMPLETE' },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: {
          id: true,
          createdAt: true,
          sampleSize: true,
          result: true,
          summary: true,
          methodologyName: true,
          methodologyVersion: true,
        },
      }),
    );

    if (runs.length === 0) {
      return {
        hasData: false as const,
        message: 'No pay equity analysis has been run yet.',
      };
    }

    const latest = runs[0]!;
    const previous = runs[1] ?? null;

    const extract = (run: typeof latest) => {
      const env = run.result as unknown as PayEquityAgentResult<{
        regressionResults: Array<{
          dimension: string;
          group: string;
          gapPercent: number;
          pValue: number;
          significance: string;
          sampleSize: number;
        }>;
        overallStats: { totalEmployees: number };
      }>;
      const sigGaps = env.output.regressionResults.filter((r) => r.significance === 'significant');
      const worst = env.output.regressionResults.reduce(
        (a, b) => (Math.abs(a.gapPercent) > Math.abs(b.gapPercent) ? a : b),
        env.output.regressionResults[0] ?? {
          dimension: '',
          group: '',
          gapPercent: 0,
          pValue: 1,
          significance: 'not_significant',
          sampleSize: 0,
        },
      );
      return {
        worstGapPercent: worst.gapPercent,
        worstCohort: worst.dimension && `${worst.dimension}/${worst.group}`,
        worstPValue: worst.pValue,
        significantCount: sigGaps.length,
        atRiskEmployees: sigGaps.reduce((s, r) => s + r.sampleSize, 0),
        totalEmployees: env.output.overallStats.totalEmployees,
        confidence: env.confidence,
        warningCount: env.warnings.length,
      };
    };

    const latestStats = extract(latest);
    const prevStats = previous ? extract(previous) : null;

    return {
      hasData: true as const,
      latestRunId: latest.id,
      latestRunAt: latest.createdAt,
      methodology: `${latest.methodologyName}@${latest.methodologyVersion}`,
      ...latestStats,
      delta: prevStats
        ? {
            worstGapPercentDelta: latestStats.worstGapPercent - prevStats.worstGapPercent,
            significantCountDelta: latestStats.significantCount - prevStats.significantCount,
          }
        : null,
      summary: latest.summary,
    };
  }

  // ─── Phase 1.2: Trend chart ──────────────────────────────────────────────

  /**
   * Time series of the worst gap (or per-dimension gaps) across the last
   * N completed runs. Used by the Diagnose tab's 8-quarter trend chart.
   *
   * Returns oldest→newest so the chart axis is left-to-right chronological.
   */
  async getTrend(tenantId: string, options: { dimension?: string; limit?: number } = {}) {
    const limit = Math.max(1, Math.min(40, options.limit ?? 20));
    const runs = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.findMany({
        where: { tenantId, agentType: 'narrative', status: 'COMPLETE' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          createdAt: true,
          methodologyName: true,
          methodologyVersion: true,
          result: true,
        },
      }),
    );

    const series = runs.reverse().map((run) => {
      const env = run.result as unknown as PayEquityAgentResult<{
        regressionResults: Array<{
          dimension: string;
          group: string;
          gapPercent: number;
          pValue: number;
          significance: string;
          sampleSize: number;
        }>;
        overallStats: { totalEmployees: number };
      }>;

      // Worst absolute gap, optionally filtered by dimension.
      const recs = options.dimension
        ? env.output.regressionResults.filter((r) => r.dimension === options.dimension)
        : env.output.regressionResults;

      const worst =
        recs.length === 0
          ? null
          : recs.reduce((a, b) => (Math.abs(a.gapPercent) > Math.abs(b.gapPercent) ? a : b));

      const sigCount = recs.filter((r) => r.significance === 'significant').length;

      return {
        runId: run.id,
        at: run.createdAt,
        methodology: `${run.methodologyName}@${run.methodologyVersion}`,
        worstGapPercent: worst?.gapPercent ?? 0,
        worstCohort: worst ? `${worst.dimension}/${worst.group}` : null,
        significantCount: sigCount,
        totalEmployees: env.output.overallStats.totalEmployees,
        // Track methodology drift in the chart — UI can color points where the
        // methodology changed mid-series.
        methodologyVersion: run.methodologyVersion,
      };
    });

    // Detect methodology shifts so the UI can flag them.
    const methodologyShifts: number[] = [];
    for (let i = 1; i < series.length; i++) {
      if (series[i]!.methodologyVersion !== series[i - 1]!.methodologyVersion) {
        methodologyShifts.push(i);
      }
    }

    return {
      series,
      methodologyShifts,
      dimension: options.dimension ?? null,
    };
  }

  // ─── Phase 1.3: Cohort matrix ────────────────────────────────────────────

  /**
   * Multi-dim cohort matrix from a single run's result. Returns an array of
   * cells suitable for rendering as a heatmap. Each cell carries the gap %,
   * p-value, sample size, and a k-anonymity flag.
   */
  async getCohorts(tenantId: string, runId: string) {
    const run = await this.getRun(tenantId, runId);
    if (run.status !== 'COMPLETE') {
      throw new BadRequestException(`Run ${runId} is ${run.status}, no cohorts available`);
    }

    const env = run.result as unknown as PayEquityAgentResult<{
      regressionResults: Array<{
        dimension: string;
        group: string;
        referenceGroup: string;
        gapPercent: number;
        pValue: number;
        significance: string;
        sampleSize: number;
        coefficient: number;
        standardError: number;
        confidenceInterval: [number, number];
        riskLevel: string;
      }>;
      compaRatios: Array<{
        dimension: string;
        group: string;
        avgCompaRatio: number;
        medianCompaRatio: number;
        count: number;
      }>;
    }>;

    const cells = env.output.regressionResults.map((r) => {
      const compa = env.output.compaRatios.find(
        (c) => c.dimension === r.dimension && c.group === r.group,
      );
      const kAnonymitySafe = r.sampleSize >= 5;
      return {
        dimension: r.dimension,
        group: r.group,
        referenceGroup: r.referenceGroup,
        gapPercent: r.gapPercent,
        pValue: r.pValue,
        significance: r.significance,
        sampleSize: r.sampleSize,
        riskLevel: r.riskLevel,
        avgCompaRatio: compa?.avgCompaRatio ?? null,
        medianCompaRatio: compa?.medianCompaRatio ?? null,
        suppressed: !kAnonymitySafe,
        // For UI rendering — color intensity: 0 = neutral, 1 = max severity.
        severityScore: Math.min(1, (Math.abs(r.gapPercent) / 10) * (r.pValue < 0.05 ? 1 : 0.5)),
      };
    });

    const dimensions = Array.from(new Set(cells.map((c) => c.dimension)));
    const warnings = env.warnings;

    return {
      runId,
      runAt: run.createdAt,
      dimensions,
      cells,
      warnings,
      methodology: `${run.methodologyName}@${run.methodologyVersion}`,
    };
  }

  // ─── Phase 1.4: Cohort drill-down ────────────────────────────────────────

  /**
   * Drill into a specific cohort cell from a run. Returns the employee rows
   * matching the (dimension, group) filter, redacted for k-anonymity, plus
   * the statistical test for the cohort.
   *
   * Limits to 200 rows; UI paginates from there.
   */
  async getCohortDetail(
    tenantId: string,
    runId: string,
    dimension: string,
    group: string,
    options: { limit?: number } = {},
  ) {
    const run = await this.getRun(tenantId, runId);
    if (run.status !== 'COMPLETE') {
      throw new BadRequestException(`Run ${runId} is ${run.status}, no detail available`);
    }
    const limit = Math.max(1, Math.min(200, options.limit ?? 50));

    const env = run.result as unknown as PayEquityAgentResult<{
      regressionResults: Array<{
        dimension: string;
        group: string;
        referenceGroup: string;
        gapPercent: number;
        pValue: number;
        significance: string;
        sampleSize: number;
        coefficient: number;
        standardError: number;
        confidenceInterval: [number, number];
      }>;
    }>;

    const stat = env.output.regressionResults.find(
      (r) => r.dimension === dimension && r.group === group,
    );
    if (!stat) {
      throw new NotFoundException(`Cohort ${dimension}/${group} not found in run ${runId}`);
    }

    // k-anonymity gate: refuse to return individuals if cohort < 5.
    if (stat.sampleSize < 5) {
      return {
        runId,
        dimension,
        group,
        suppressed: true,
        suppressionReason: `Cohort has n=${stat.sampleSize}; below k=5 threshold`,
        statisticalTest: stat,
        rows: [] as Array<unknown>,
        truncated: false,
      };
    }

    const rows = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.findMany({
        where: this.buildCohortWhere(tenantId, dimension, group),
        take: limit,
        orderBy: { lastName: 'asc' },
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          department: true,
          level: true,
          location: true,
          hireDate: true,
          baseSalary: true,
          currency: true,
          performanceRating: true,
          compaRatio: true,
        },
      }),
    );

    return {
      runId,
      dimension,
      group,
      suppressed: false,
      statisticalTest: stat,
      rows: rows.map((r) => ({
        id: r.id,
        employeeCode: r.employeeCode,
        name: `${r.firstName} ${r.lastName}`.trim(),
        department: r.department,
        level: r.level,
        location: r.location,
        hireDate: r.hireDate,
        baseSalary: Number(r.baseSalary),
        currency: r.currency,
        performanceRating: r.performanceRating ? Number(r.performanceRating) : null,
        compaRatio: r.compaRatio ? Number(r.compaRatio) : null,
      })),
      truncated: rows.length === limit,
    };
  }

  /**
   * Translate a (dimension, group) into a Prisma WHERE for Employee.
   * Phase 1 supports the protected-class dimensions Compport tracks today;
   * race/ethnicity is not directly available on Employee — those cohorts
   * use metadata or a join (deferred to Phase 1.5).
   */
  private buildCohortWhere(
    tenantId: string,
    dimension: string,
    group: string,
  ): Prisma.EmployeeWhereInput {
    const where: Prisma.EmployeeWhereInput = { tenantId, baseSalary: { gt: 0 } };
    switch (dimension.toLowerCase()) {
      case 'gender':
        where.gender = group;
        break;
      case 'department':
        where.department = group;
        break;
      case 'location':
        where.location = group;
        break;
      case 'level':
        where.level = group;
        break;
      // Phase 1.5+: ethnicity, age_band require richer schema mapping
      default:
        // Unknown dimension — return only tenant-scoped employees so the
        // statistical test still makes sense (cohort vs full population).
        break;
    }
    return where;
  }

  // ─── Phase 1.7: Outliers ─────────────────────────────────────────────────

  /**
   * Per-employee outliers for a run: employees whose individual comp position
   * deviates most from the cohort mean (controlling for level + tenure).
   * Pure statistical for Phase 1; AI explainer added in Phase 1.5.
   */
  async getOutliers(
    tenantId: string,
    runId: string,
    options: { dimension?: string; limit?: number } = {},
  ) {
    const run = await this.getRun(tenantId, runId);
    if (run.status !== 'COMPLETE') {
      throw new BadRequestException(`Run ${runId} is ${run.status}`);
    }
    const limit = Math.max(1, Math.min(100, options.limit ?? 20));

    // Pull all employees once, compute residuals against the cohort cell
    // mean to identify outliers. We skip the heavy regression for Phase 1
    // and use compaRatio as a proxy — outliers are the lowest compaRatios
    // within statistically-significant cohorts.
    const env = run.result as unknown as PayEquityAgentResult<{
      regressionResults: Array<{
        dimension: string;
        group: string;
        gapPercent: number;
        pValue: number;
        significance: string;
        sampleSize: number;
      }>;
    }>;

    const significantCohorts = env.output.regressionResults
      .filter((r) => r.significance === 'significant')
      .filter((r) => !options.dimension || r.dimension === options.dimension);

    // Single typed array used in both empty and populated branches so the
    // return type is consistent (avoids `outliers: []` collapsing to never[]).
    const allOutliers: OutlierRow[] = [];

    if (significantCohorts.length === 0) {
      return {
        runId,
        outliers: allOutliers,
        reason: 'No statistically-significant cohorts in this run.',
      };
    }

    for (const cohort of significantCohorts) {
      const candidates = await this.db.forTenant(tenantId, (tx) =>
        tx.employee.findMany({
          where: {
            ...this.buildCohortWhere(tenantId, cohort.dimension, cohort.group),
            compaRatio: { not: null, lt: 1 },
          },
          take: limit,
          orderBy: { compaRatio: 'asc' },
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            department: true,
            level: true,
            baseSalary: true,
            currency: true,
            compaRatio: true,
          },
        }),
      );

      for (const c of candidates) {
        if (c.compaRatio === null) continue;
        allOutliers.push({
          employeeId: c.id,
          employeeCode: c.employeeCode,
          name: `${c.firstName} ${c.lastName}`.trim(),
          department: c.department,
          level: c.level,
          compaRatio: Number(c.compaRatio),
          baseSalary: Number(c.baseSalary),
          currency: c.currency,
          cohort: { dimension: cohort.dimension, group: cohort.group },
          gapPercent: cohort.gapPercent,
          explanation: `compa-ratio ${Number(c.compaRatio).toFixed(2)} in cohort ${cohort.dimension}/${cohort.group} which has a ${cohort.gapPercent}% adjusted gap`,
        });
      }
    }

    // Globally sort by compa-ratio (lowest first) and take top N.
    allOutliers.sort((a, b) => a.compaRatio - b.compaRatio);
    return {
      runId,
      outliers: allOutliers.slice(0, limit),
      total: allOutliers.length,
    };
  }
}
