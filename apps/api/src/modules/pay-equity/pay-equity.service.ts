import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import { Prisma } from '@compensation/database';
import {
  buildResult,
  checkKAnonymity,
  checkSampleSize,
  invokeCohortRootCauseGraph,
  invokeOutlierExplainerGraph,
  invokeRemediationGraph,
  type AgentWarning,
  type PayEquityAgentResult,
  type PayEquityMethodology,
} from '@compensation/ai';
import { DatabaseService } from '../../database';
import {
  PayEquityService as LegacyAnalyzer,
  type PayEquityReport,
} from '../analytics/pay-equity.service';
import type { RunPayEquityAnalysisDto } from './dto/run-analysis.dto';
import type { ListPayEquityRunsDto } from './dto/list-runs.dto';
import { renderReport, REPORT_TYPES, type ReportType } from './report-renderers';

/**
 * Phase 1: cohort drill-down row shape. Module-scope so the suppressed
 * branch can use the same row type instead of collapsing to unknown[].
 */
interface CohortDetailRow {
  id: string;
  employeeCode: string;
  name: string;
  department: string;
  level: string;
  location: string | null;
  hireDate: Date;
  baseSalary: number;
  currency: string;
  performanceRating: number | null;
  compaRatio: number | null;
}

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
export class PayEquityV2Service implements OnModuleInit {
  private readonly logger = new Logger(PayEquityV2Service.name);

  /** Frozen methodology for the narrative agent. Bump version when EDGE spec or controls change. */
  static readonly METHODOLOGY_VERSION = '2026.04';
  static readonly METHODOLOGY_NAME = 'edge-multivariate';

  /** Resolved at module init; null = no Chrome → Phase 3 PDF reports unavailable. */
  private chromePathCache: string | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly legacy: LegacyAnalyzer,
  ) {}

  onModuleInit() {
    const envPath = process.env['PUPPETEER_EXECUTABLE_PATH'];
    if (envPath && existsSync(envPath)) {
      this.chromePathCache = envPath;
      return;
    }
    const candidates = [
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable',
    ];
    this.chromePathCache = candidates.find((p) => existsSync(p)) ?? null;
    if (!this.chromePathCache) {
      this.logger.warn(
        'No Chrome/Chromium binary found — Phase 3 PDF report exports will return 503',
      );
    }
  }

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
      const empty: CohortDetailRow[] = [];
      return {
        runId,
        dimension,
        group,
        suppressed: true,
        suppressionReason: `Cohort has n=${stat.sampleSize}; below k=5 threshold`,
        statisticalTest: stat,
        rows: empty,
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
      rows: rows.map<CohortDetailRow>((r) => ({
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

  // ─── Phase 1.5: Cohort root-cause AI ───────────────────────────────────

  /**
   * Invoke the cohort root-cause LLM agent for a single cohort cell. The
   * service is responsible for computing the deterministic context the agent
   * needs (within-cohort distributions by level/tenure/department, sibling
   * cohorts, top driver candidates) so the agent never has to query the DB
   * itself and never fabricates numbers.
   *
   * Persists as a separate PayEquityRun row with agentType='cohort_root_cause'
   * so each invocation is auditable + the eval harness has a stable target.
   */
  async analyzeCohortRootCause(
    tenantId: string,
    parentRunId: string,
    dimension: string,
    group: string,
    userId: string,
  ) {
    const parentRun = await this.getRun(tenantId, parentRunId);
    if (parentRun.status !== 'COMPLETE') {
      throw new BadRequestException(`Parent run ${parentRunId} is ${parentRun.status}`);
    }

    const env = parentRun.result as unknown as PayEquityAgentResult<{
      regressionResults: Array<{
        dimension: string;
        group: string;
        referenceGroup: string;
        gapPercent: number;
        pValue: number;
        sampleSize: number;
        coefficient: number;
        significance: string;
      }>;
    }>;

    const cell = env.output.regressionResults.find(
      (r) => r.dimension === dimension && r.group === group,
    );
    if (!cell) {
      throw new NotFoundException(`Cohort ${dimension}/${group} not in run ${parentRunId}`);
    }
    if (cell.sampleSize < 5) {
      throw new BadRequestException(
        `Cohort ${dimension}/${group} has n=${cell.sampleSize}; below k=5 threshold`,
      );
    }

    const siblingCohorts = env.output.regressionResults
      .filter((r) => r.dimension === dimension && r.group !== group)
      .map((r) => ({
        group: r.group,
        gapPercent: r.gapPercent,
        pValue: r.pValue,
        sampleSize: r.sampleSize,
      }));

    // Pre-create the child run row so we have a runId even if the LLM fails.
    const childRun = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.create({
        data: {
          tenantId,
          userId,
          agentType: 'cohort_root_cause',
          methodologyName: parentRun.methodologyName,
          methodologyVersion: parentRun.methodologyVersion,
          controls: parentRun.controls,
          status: 'PENDING',
          summary: `Root-cause analysis for ${dimension}/${group} (parent run ${parentRunId})`,
          sampleSize: cell.sampleSize,
        },
      }),
    );

    try {
      // ─── Compute deterministic distributions for the agent ──
      const cohortWhere = this.buildCohortWhere(tenantId, dimension, group);
      const employees = await this.db.forTenant(tenantId, (tx) =>
        tx.employee.findMany({
          where: cohortWhere,
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            level: true,
            department: true,
            location: true,
            hireDate: true,
            baseSalary: true,
            currency: true,
            compaRatio: true,
          },
        }),
      );

      const distributions = computeDistributions(employees);
      const driverCandidates = employees
        .filter((e) => e.compaRatio !== null && Number(e.compaRatio) < 0.95)
        .sort((a, b) => Number(a.compaRatio) - Number(b.compaRatio))
        .slice(0, 8)
        .map((e) => ({
          id: e.id,
          employeeCode: e.employeeCode,
          name: `${e.firstName} ${e.lastName}`.trim(),
          level: e.level,
          department: e.department,
          baseSalary: Number(e.baseSalary),
          compaRatio: e.compaRatio !== null ? Number(e.compaRatio) : null,
        }));

      const envelope = await invokeCohortRootCauseGraph({
        tenantId,
        userId,
        cohort: {
          dimension,
          group,
          referenceGroup: cell.referenceGroup,
          gapPercent: cell.gapPercent,
          pValue: cell.pValue,
          sampleSize: cell.sampleSize,
          coefficient: cell.coefficient,
        },
        distributions,
        siblingCohorts,
        driverCandidates,
        methodology: {
          name: parentRun.methodologyName,
          version: parentRun.methodologyVersion,
          controls: parentRun.controls,
          sampleSize: env.methodology.sampleSize,
        },
      });

      // Stamp the child runId into the envelope before persisting.
      const finalEnvelope = { ...envelope, runId: childRun.id };

      await this.db.forTenant(tenantId, async (tx) => {
        await tx.payEquityRun.update({
          where: { id: childRun.id },
          data: {
            status: 'COMPLETE',
            result: finalEnvelope as unknown as Prisma.InputJsonValue,
            summary: `${finalEnvelope.output.rootCauses.length} root cause(s) for ${dimension}/${group}`,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'PAY_EQUITY_COHORT_ROOT_CAUSE',
            entityType: 'PayEquityRun',
            entityId: childRun.id,
            changes: {
              parentRunId,
              dimension,
              group,
              rootCauseCount: finalEnvelope.output.rootCauses.length,
              methodologyVersion: parentRun.methodologyVersion,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      });

      this.logger.log(
        `Cohort root-cause: parent=${parentRunId} child=${childRun.id} ${dimension}/${group}`,
      );
      return { runId: childRun.id, envelope: finalEnvelope };
    } catch (err) {
      this.logger.error(`Cohort root-cause failed for ${childRun.id}`, err);
      await this.db.forTenant(tenantId, (tx) =>
        tx.payEquityRun.update({
          where: { id: childRun.id },
          data: {
            status: 'FAILED',
            errorMsg: err instanceof Error ? err.message : 'Unknown error',
          },
        }),
      );
      throw err;
    }
  }

  // ─── Phase 1.5: Outlier AI explainer ───────────────────────────────────

  /**
   * Generate a one-paragraph "why is this person here" explanation for a
   * single outlier employee in a cohort. Idempotent — re-invoking creates a
   * new PayEquityRun row but doesn't change anything else.
   */
  async explainOutlier(tenantId: string, parentRunId: string, employeeId: string, userId: string) {
    const parentRun = await this.getRun(tenantId, parentRunId);
    if (parentRun.status !== 'COMPLETE') {
      throw new BadRequestException(`Parent run ${parentRunId} is ${parentRun.status}`);
    }

    const env = parentRun.result as unknown as PayEquityAgentResult<{
      regressionResults: Array<{
        dimension: string;
        group: string;
        referenceGroup: string;
        gapPercent: number;
        pValue: number;
        sampleSize: number;
        significance: string;
      }>;
    }>;

    const employee = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.findFirst({
        where: { id: employeeId, tenantId },
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          level: true,
          department: true,
          location: true,
          hireDate: true,
          baseSalary: true,
          currency: true,
          compaRatio: true,
          performanceRating: true,
          gender: true,
        },
      }),
    );
    if (!employee) {
      throw new NotFoundException(`Employee ${employeeId} not found`);
    }
    if (employee.compaRatio === null) {
      throw new BadRequestException(
        `Employee ${employeeId} has no compa-ratio — cannot identify as an outlier`,
      );
    }

    // Find a significant cohort this employee belongs to.
    const cohort = env.output.regressionResults.find(
      (r) =>
        r.significance === 'significant' &&
        this.employeeMatchesCohort(employee, r.dimension, r.group),
    );
    if (!cohort) {
      throw new BadRequestException(
        `Employee ${employeeId} is not in any statistically-significant cohort in run ${parentRunId}`,
      );
    }

    // Peer context: same level + department.
    const peers = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.findMany({
        where: {
          tenantId,
          level: employee.level,
          department: employee.department,
          baseSalary: { gt: 0 },
        },
        select: { baseSalary: true, compaRatio: true },
      }),
    );
    const peerMeanSalary =
      peers.length > 0 ? peers.reduce((s, p) => s + Number(p.baseSalary), 0) / peers.length : 0;
    const peerCRs = peers
      .map((p) => p.compaRatio)
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const peerMeanCompaRatio =
      peerCRs.length > 0 ? peerCRs.reduce((s, c) => s + Number(c), 0) / peerCRs.length : null;

    const childRun = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.create({
        data: {
          tenantId,
          userId,
          agentType: 'outlier_explainer',
          methodologyName: parentRun.methodologyName,
          methodologyVersion: parentRun.methodologyVersion,
          controls: parentRun.controls,
          status: 'PENDING',
          summary: `Outlier explainer for ${employee.employeeCode}`,
          sampleSize: 1,
        },
      }),
    );

    try {
      const envelope = await invokeOutlierExplainerGraph({
        tenantId,
        userId,
        employee: {
          id: employee.id,
          employeeCode: employee.employeeCode,
          name: `${employee.firstName} ${employee.lastName}`.trim(),
          level: employee.level,
          department: employee.department,
          location: employee.location,
          hireDate: employee.hireDate.toISOString(),
          baseSalary: Number(employee.baseSalary),
          currency: employee.currency,
          compaRatio: Number(employee.compaRatio),
          performanceRating:
            employee.performanceRating !== null ? Number(employee.performanceRating) : null,
        },
        cohort: {
          dimension: cohort.dimension,
          group: cohort.group,
          referenceGroup: cohort.referenceGroup,
          gapPercent: cohort.gapPercent,
          pValue: cohort.pValue,
          sampleSize: cohort.sampleSize,
        },
        peerContext: {
          peerCount: peers.length,
          peerMeanSalary,
          peerMeanCompaRatio,
        },
        methodology: {
          name: parentRun.methodologyName,
          version: parentRun.methodologyVersion,
          controls: parentRun.controls,
          sampleSize: env.methodology.sampleSize,
        },
      });

      const finalEnvelope = { ...envelope, runId: childRun.id };

      await this.db.forTenant(tenantId, async (tx) => {
        await tx.payEquityRun.update({
          where: { id: childRun.id },
          data: {
            status: 'COMPLETE',
            result: finalEnvelope as unknown as Prisma.InputJsonValue,
            summary: `${employee.employeeCode}: ${finalEnvelope.output.severity} severity`,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'PAY_EQUITY_OUTLIER_EXPLAIN',
            entityType: 'PayEquityRun',
            entityId: childRun.id,
            changes: {
              parentRunId,
              employeeId,
              cohort: { dimension: cohort.dimension, group: cohort.group },
              severity: finalEnvelope.output.severity,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      });

      this.logger.log(
        `Outlier explainer: parent=${parentRunId} child=${childRun.id} emp=${employee.employeeCode}`,
      );
      return { runId: childRun.id, envelope: finalEnvelope };
    } catch (err) {
      this.logger.error(`Outlier explainer failed for ${childRun.id}`, err);
      await this.db.forTenant(tenantId, (tx) =>
        tx.payEquityRun.update({
          where: { id: childRun.id },
          data: {
            status: 'FAILED',
            errorMsg: err instanceof Error ? err.message : 'Unknown error',
          },
        }),
      );
      throw err;
    }
  }

  /**
   * Lightweight membership check used by explainOutlier to find which
   * significant cohort an employee belongs to.
   */
  private employeeMatchesCohort(
    employee: {
      level: string;
      department: string;
      location: string | null;
      gender: string | null;
    },
    dimension: string,
    group: string,
  ): boolean {
    switch (dimension.toLowerCase()) {
      case 'gender':
        return employee.gender === group;
      case 'level':
        return employee.level === group;
      case 'department':
        return employee.department === group;
      case 'location':
        return employee.location === group;
      default:
        return false;
    }
  }

  // ─── Phase 2: Remediation ──────────────────────────────────────────────

  /**
   * Calculate proposed adjustments for a parent run.
   *
   * Strategy (deterministic):
   *   1. For each statistically-significant cohort with abs(gap) > targetGap,
   *      pull the employees in that cohort (k-anonymity gated).
   *   2. Compute the cohort mean salary.
   *   3. For employees with compa-ratio < 1, propose an adjustment that
   *      moves them toward the cohort mean — capped at maxPerEmployeePct of
   *      their current salary so a single bump can't exceed the cap.
   *   4. Sort by lowest compa-ratio so the biggest gainers are the most
   *      underpaid people in significant cohorts.
   *
   * Then invoke the AI remediation agent for narrative justifications and
   * scenario summaries. Persist each adjustment as a PayEquityRemediation
   * row (status=PROPOSED) and the run-level envelope as a child PayEquityRun
   * (agentType=remediation).
   */
  async calculateRemediations(
    tenantId: string,
    parentRunId: string,
    dto: { targetGapPercent: number; maxPerEmployeePct?: number; note?: string },
    userId: string,
  ) {
    const parentRun = await this.getRun(tenantId, parentRunId);
    if (parentRun.status !== 'COMPLETE') {
      throw new BadRequestException(`Parent run ${parentRunId} is ${parentRun.status}`);
    }

    const env = parentRun.result as unknown as PayEquityAgentResult<{
      regressionResults: Array<{
        dimension: string;
        group: string;
        referenceGroup: string;
        gapPercent: number;
        pValue: number;
        sampleSize: number;
        coefficient: number;
        significance: string;
      }>;
    }>;

    const targetGap = dto.targetGapPercent;
    const cap = dto.maxPerEmployeePct ?? 0.15;

    // Cohorts that need work: significant + |gap| > target.
    const needRemediation = env.output.regressionResults.filter(
      (r) =>
        r.significance === 'significant' && Math.abs(r.gapPercent) > targetGap && r.sampleSize >= 5,
    );

    if (needRemediation.length === 0) {
      throw new BadRequestException(
        `No statistically-significant cohorts exceed target gap of ${targetGap}% in run ${parentRunId}`,
      );
    }

    // Pre-create the remediation run row.
    const childRun = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.create({
        data: {
          tenantId,
          userId,
          agentType: 'remediation',
          methodologyName: parentRun.methodologyName,
          methodologyVersion: parentRun.methodologyVersion,
          controls: parentRun.controls,
          status: 'PENDING',
          summary:
            dto.note ??
            `Remediation plan for ${needRemediation.length} cohort(s), target ${targetGap}%`,
          sampleSize: 0,
        },
      }),
    );

    try {
      // ─── Compute deterministic adjustments per cohort ──
      const proposedAdjustments: Array<{
        employeeId: string;
        employeeCode: string;
        name: string;
        level: string;
        department: string;
        cohort: { dimension: string; group: string };
        currentSalary: number;
        proposedSalary: number;
        currency: string;
        currentCompaRatio: number | null;
        cohortMeanSalary: number;
      }> = [];

      for (const cohort of needRemediation) {
        const employees = await this.db.forTenant(tenantId, (tx) =>
          tx.employee.findMany({
            where: this.buildCohortWhere(tenantId, cohort.dimension, cohort.group),
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              level: true,
              department: true,
              baseSalary: true,
              currency: true,
              compaRatio: true,
            },
          }),
        );

        if (employees.length === 0) continue;

        const meanSalary =
          employees.reduce((s, e) => s + Number(e.baseSalary), 0) / employees.length;

        // Propose adjustments for employees with CR < 1 in this cohort.
        for (const e of employees) {
          if (e.compaRatio === null) continue;
          const cr = Number(e.compaRatio);
          if (cr >= 1) continue;
          const current = Number(e.baseSalary);

          // Move toward cohort mean by 50% of the gap, capped at maxPerEmployeePct.
          const halfGap = (meanSalary - current) * 0.5;
          const cappedDelta = Math.min(halfGap, current * cap);
          if (cappedDelta <= 0) continue;
          const proposed = Math.round((current + cappedDelta) * 100) / 100;

          proposedAdjustments.push({
            employeeId: e.id,
            employeeCode: e.employeeCode,
            name: `${e.firstName} ${e.lastName}`.trim(),
            level: e.level,
            department: e.department,
            cohort: { dimension: cohort.dimension, group: cohort.group },
            currentSalary: current,
            proposedSalary: proposed,
            currency: e.currency,
            currentCompaRatio: cr,
            cohortMeanSalary: meanSalary,
          });
        }
      }

      // Sort by lowest CR first — biggest gainers are most underpaid.
      proposedAdjustments.sort((a, b) => (a.currentCompaRatio ?? 1) - (b.currentCompaRatio ?? 1));

      const totalCost = proposedAdjustments.reduce(
        (s, a) => s + (a.proposedSalary - a.currentSalary),
        0,
      );

      const worstGap = needRemediation.reduce((a, b) =>
        Math.abs(a.gapPercent) > Math.abs(b.gapPercent) ? a : b,
      );

      // ─── Invoke AI for narrative justifications ──
      const envelope = await invokeRemediationGraph({
        tenantId,
        userId,
        adjustments: proposedAdjustments,
        plan: {
          targetGapPercent: targetGap,
          totalCost,
          affectedEmployees: proposedAdjustments.length,
          cohortsAddressed: needRemediation.map((c) => ({
            dimension: c.dimension,
            group: c.group,
            gapPercent: c.gapPercent,
          })),
          currentWorstGap: worstGap.gapPercent,
        },
        methodology: {
          name: parentRun.methodologyName,
          version: parentRun.methodologyVersion,
          controls: parentRun.controls,
          sampleSize: env.methodology.sampleSize,
        },
      });

      const finalEnvelope = { ...envelope, runId: childRun.id };

      // ─── Persist: child run + per-employee PayEquityRemediation rows ──
      await this.db.forTenant(tenantId, async (tx) => {
        await tx.payEquityRun.update({
          where: { id: childRun.id },
          data: {
            status: 'COMPLETE',
            sampleSize: proposedAdjustments.length,
            result: finalEnvelope as unknown as Prisma.InputJsonValue,
            summary: `${proposedAdjustments.length} adjustment(s) proposed across ${needRemediation.length} cohort(s), total cost ${totalCost.toFixed(0)}`,
          },
        });

        // One PayEquityRemediation row per proposed adjustment, with the
        // AI-narrated justification mapped back by employeeId.
        const justByEmp = new Map(
          finalEnvelope.output.adjustments.map((a) => [a.employeeId, a.justification]),
        );
        if (proposedAdjustments.length > 0) {
          await tx.payEquityRemediation.createMany({
            data: proposedAdjustments.map((a) => ({
              tenantId,
              runId: childRun.id,
              employeeId: a.employeeId,
              fromValue: a.currentSalary,
              toValue: a.proposedSalary,
              justification: justByEmp.get(a.employeeId) ?? null,
              status: 'PROPOSED',
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'PAY_EQUITY_REMEDIATION_PROPOSED',
            entityType: 'PayEquityRun',
            entityId: childRun.id,
            changes: {
              parentRunId,
              targetGapPercent: targetGap,
              affectedEmployees: proposedAdjustments.length,
              totalCost,
              cohortsAddressed: needRemediation.length,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      });

      this.logger.log(
        `Remediation calc: parent=${parentRunId} child=${childRun.id} adjustments=${proposedAdjustments.length} totalCost=${totalCost.toFixed(0)}`,
      );

      return { runId: childRun.id, envelope: finalEnvelope };
    } catch (err) {
      this.logger.error(`Remediation calc failed for ${childRun.id}`, err);
      await this.db.forTenant(tenantId, (tx) =>
        tx.payEquityRun.update({
          where: { id: childRun.id },
          data: {
            status: 'FAILED',
            errorMsg: err instanceof Error ? err.message : 'Unknown error',
          },
        }),
      );
      throw err;
    }
  }

  /**
   * List per-employee remediation rows attached to a remediation run.
   */
  async listRemediations(tenantId: string, remediationRunId: string) {
    const run = await this.getRun(tenantId, remediationRunId);
    if (run.agentType !== 'remediation') {
      throw new BadRequestException(
        `Run ${remediationRunId} is agentType=${run.agentType}; expected remediation`,
      );
    }
    const rows = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRemediation.findMany({
        where: { tenantId, runId: remediationRunId },
        orderBy: [{ status: 'asc' }, { fromValue: 'asc' }],
      }),
    );

    // Hydrate with employee data for the table.
    const employeeIds = rows.map((r) => r.employeeId);
    const employees =
      employeeIds.length > 0
        ? await this.db.forTenant(tenantId, (tx) =>
            tx.employee.findMany({
              where: { tenantId, id: { in: employeeIds } },
              select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                department: true,
                level: true,
                currency: true,
                compaRatio: true,
              },
            }),
          )
        : [];
    const empById = new Map(employees.map((e) => [e.id, e]));

    return rows.map((r) => {
      const e = empById.get(r.employeeId);
      const from = Number(r.fromValue);
      const to = Number(r.toValue);
      return {
        id: r.id,
        runId: r.runId,
        employeeId: r.employeeId,
        employeeCode: e?.employeeCode ?? r.employeeId,
        name: e ? `${e.firstName} ${e.lastName}`.trim() : r.employeeId,
        department: e?.department ?? null,
        level: e?.level ?? null,
        currency: e?.currency ?? 'USD',
        currentCompaRatio: e?.compaRatio ? Number(e.compaRatio) : null,
        fromValue: from,
        toValue: to,
        deltaValue: to - from,
        deltaPercent: from > 0 ? Math.round(((to - from) / from) * 10000) / 100 : 0,
        justification: r.justification,
        status: r.status,
        appliedCycleId: r.appliedCycleId,
        appliedAt: r.appliedAt,
        decidedByUserId: r.decidedByUserId,
        decidedAt: r.decidedAt,
        createdAt: r.createdAt,
      };
    });
  }

  /**
   * Approve or decline a single proposed remediation. Audit-logged.
   */
  async decideRemediation(
    tenantId: string,
    remediationId: string,
    decision: 'APPROVED' | 'DECLINED',
    userId: string,
    note?: string,
  ) {
    return this.db.forTenant(tenantId, async (tx) => {
      const row = await tx.payEquityRemediation.findFirst({
        where: { id: remediationId, tenantId },
      });
      if (!row) throw new NotFoundException(`Remediation ${remediationId} not found`);
      if (row.status !== 'PROPOSED') {
        throw new BadRequestException(
          `Remediation ${remediationId} is ${row.status}; can only decide PROPOSED`,
        );
      }

      const updated = await tx.payEquityRemediation.update({
        where: { id: remediationId },
        data: {
          status: decision,
          decidedByUserId: userId,
          decidedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: `PAY_EQUITY_REMEDIATION_${decision}`,
          entityType: 'PayEquityRemediation',
          entityId: remediationId,
          changes: {
            employeeId: row.employeeId,
            fromValue: Number(row.fromValue),
            toValue: Number(row.toValue),
            note: note ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `Remediation ${decision}: id=${remediationId} emp=${row.employeeId} by user=${userId}`,
      );
      return updated;
    });
  }

  /**
   * Apply all APPROVED remediations on a remediation run:
   *   1. For each row, update Employee.baseSalary in one transaction.
   *   2. Mark each row APPLIED with timestamp.
   *   3. Write one AuditLog row per change (action=PAY_EQUITY_REMEDIATION_APPLIED).
   *   4. Returns counts. The remediation run row stays COMPLETE; per-row
   *      status becomes APPLIED so the UI can reflect the closed loop.
   *
   * No CompCycle is created — pay equity adjustments are tracked in their
   * own audit trail. Phase 2.5 follow-up: optionally also link to a
   * CompCycle for unified history.
   */
  async applyApprovedRemediations(tenantId: string, remediationRunId: string, userId: string) {
    const run = await this.getRun(tenantId, remediationRunId);
    if (run.agentType !== 'remediation') {
      throw new BadRequestException(
        `Run ${remediationRunId} is agentType=${run.agentType}; expected remediation`,
      );
    }

    return this.db.forTenant(tenantId, async (tx) => {
      const approved = await tx.payEquityRemediation.findMany({
        where: { tenantId, runId: remediationRunId, status: 'APPROVED' },
      });

      if (approved.length === 0) {
        return { applied: 0, totalCost: 0, employeeIds: [] as string[] };
      }

      let totalCost = 0;
      const employeeIds: string[] = [];

      for (const r of approved) {
        const from = Number(r.fromValue);
        const to = Number(r.toValue);
        await tx.employee.update({
          where: { id: r.employeeId },
          data: { baseSalary: to },
        });
        await tx.payEquityRemediation.update({
          where: { id: r.id },
          data: { status: 'APPLIED', appliedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'PAY_EQUITY_REMEDIATION_APPLIED',
            entityType: 'Employee',
            entityId: r.employeeId,
            changes: {
              remediationId: r.id,
              runId: remediationRunId,
              fromValue: from,
              toValue: to,
              delta: to - from,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        totalCost += to - from;
        employeeIds.push(r.employeeId);
      }

      this.logger.log(
        `Remediation applied: run=${remediationRunId} count=${approved.length} cost=${totalCost.toFixed(0)}`,
      );
      return { applied: approved.length, totalCost, employeeIds };
    });
  }

  // ─── Phase 3 — Report ──────────────────────────────────────────

  /**
   * Generate a downloadable report artifact for a stored run.
   *
   * - Reads the immutable PayEquityRun envelope (no re-computation)
   * - Routes to the appropriate renderer (CSV string or PDF-ready HTML)
   * - For PDF, runs Puppeteer with the cached Chrome path
   * - Writes a PAY_EQUITY_REPORT_EXPORTED audit log row per export
   * - Returns { buffer, filename, mimeType } for the controller to send
   */
  async generateReport(
    tenantId: string,
    runId: string,
    type: ReportType,
    userId: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    if (!REPORT_TYPES.includes(type)) {
      throw new BadRequestException(`Unknown report type: ${type}`);
    }

    const run = await this.getRun(tenantId, runId);
    if (run.status !== 'COMPLETE') {
      throw new BadRequestException(`Run ${runId} is ${run.status}, cannot export`);
    }
    if (run.agentType !== 'narrative') {
      throw new BadRequestException(
        `Run ${runId} agentType=${run.agentType}, only narrative runs are exportable`,
      );
    }

    const tenant = await this.db.forTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    );

    const envelope = run.result as unknown as PayEquityAgentResult<PayEquityReport>;

    const out = renderReport(type, {
      runId,
      runAt: run.createdAt,
      tenantId,
      tenantName: tenant?.name ?? 'Company',
      envelope,
    });

    let buffer: Buffer;
    if (out.format === 'csv') {
      // Prefix UTF-8 BOM so Excel opens the file in UTF-8 instead of cp1252.
      const bom = Buffer.from([0xef, 0xbb, 0xbf]);
      buffer = Buffer.concat([bom, Buffer.from(out.content, 'utf-8')]);
    } else {
      if (!this.chromePathCache) {
        throw new BadRequestException(
          'PDF rendering unavailable on this server (no Chrome/Chromium binary). Set PUPPETEER_EXECUTABLE_PATH.',
        );
      }
      buffer = await this.renderHtmlToPdf(out.html, this.chromePathCache);
    }

    await this.db.forTenant(tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'PAY_EQUITY_REPORT_EXPORTED',
          entityType: 'PayEquityRun',
          entityId: runId,
          changes: {
            reportType: type,
            filename: out.filename,
            byteLength: buffer.length,
            methodologyVersion: run.methodologyVersion,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    );

    this.logger.log(`Report exported: run=${runId} type=${type} bytes=${buffer.length}`);

    return { buffer, filename: out.filename, mimeType: out.mimeType };
  }

  private async renderHtmlToPdf(html: string, executablePath: string): Promise<Buffer> {
    const PDF_TIMEOUT_MS = 30_000;
    const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        p.then(
          (v) => {
            clearTimeout(t);
            resolve(v);
          },
          (e: unknown) => {
            clearTimeout(t);
            reject(e instanceof Error ? e : new Error(String(e)));
          },
        );
      });

    const puppeteer = await import('puppeteer-core');
    const browser = await withTimeout(
      puppeteer.default.launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
        ],
      }),
      PDF_TIMEOUT_MS,
      'puppeteer launch',
    );
    try {
      const page = await browser.newPage();
      await withTimeout(
        page.setContent(html, { waitUntil: 'domcontentloaded' }),
        PDF_TIMEOUT_MS,
        'puppeteer setContent',
      );
      const pdfUint8 = await withTimeout(
        page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
        }),
        PDF_TIMEOUT_MS,
        'puppeteer pdf',
      );
      return Buffer.from(pdfUint8);
    } finally {
      try {
        await browser.close();
      } catch (closeErr) {
        this.logger.warn(`Failed to close puppeteer browser: ${(closeErr as Error).message}`);
      }
    }
  }
}

// ─── Phase 1.5 helper: deterministic distribution computation ──────────

/**
 * Compute by-level / by-tenure / by-department distributions for a list
 * of employees. The cohort root-cause agent receives these instead of raw
 * rows so the LLM has structured context to reason from.
 */
function computeDistributions(
  employees: Array<{
    level: string;
    department: string;
    hireDate: Date;
    baseSalary: number | { toString(): string };
    compaRatio: number | { toString(): string } | null;
  }>,
) {
  const TENURE_BUCKETS = ['0-1y', '1-3y', '3-5y', '5-10y', '10+y'] as const;
  const tenureOf = (hireDate: Date) => {
    const years = (Date.now() - hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (years < 1) return TENURE_BUCKETS[0];
    if (years < 3) return TENURE_BUCKETS[1];
    if (years < 5) return TENURE_BUCKETS[2];
    if (years < 10) return TENURE_BUCKETS[3];
    return TENURE_BUCKETS[4];
  };

  const groupBy = <K extends string | number>(
    rows: typeof employees,
    keyFn: (e: (typeof employees)[number]) => K,
  ) => {
    const buckets = new Map<K, typeof employees>();
    for (const e of rows) {
      const k = keyFn(e);
      const arr = buckets.get(k) ?? [];
      arr.push(e);
      buckets.set(k, arr);
    }
    return buckets;
  };

  const meanSalary = (rows: typeof employees) =>
    rows.length === 0 ? 0 : rows.reduce((s, e) => s + Number(e.baseSalary), 0) / rows.length;
  const meanCR = (rows: typeof employees): number | null => {
    const crs: number[] = rows
      .map((e) => (e.compaRatio === null ? null : Number(e.compaRatio)))
      .filter((n): n is number => n !== null);
    if (crs.length === 0) return null;
    return crs.reduce((s: number, n: number) => s + n, 0) / crs.length;
  };

  const byLevel = [...groupBy(employees, (e) => e.level).entries()]
    .map(([level, rows]) => ({
      level,
      n: rows.length,
      meanSalary: meanSalary(rows),
      meanCompaRatio: meanCR(rows),
    }))
    .sort((a, b) => b.n - a.n);

  const byTenureBucket = [...groupBy(employees, (e) => tenureOf(e.hireDate)).entries()]
    .map(([bucket, rows]) => ({
      bucket: bucket as string,
      n: rows.length,
      meanSalary: meanSalary(rows),
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));

  const byDepartment = [...groupBy(employees, (e) => e.department).entries()]
    .map(([department, rows]) => ({
      department,
      n: rows.length,
      meanSalary: meanSalary(rows),
    }))
    .sort((a, b) => b.n - a.n);

  return { byLevel, byTenureBucket, byDepartment };
}
