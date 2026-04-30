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
  invokePayEquityCopilotGraph,
  invokeProjectionGraph,
  invokeRemediationGraph,
  type AgentWarning,
  type CopilotOutput,
  type GapProjectionOutput,
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

  /**
   * Phase 2.4 — Phased multi-quarter plan generator.
   *
   * Splits the PROPOSED + APPROVED rows of a remediation run into N quarter
   * buckets, biggest deltas first (front-loaded), so finance can budget per
   * quarter. Read-only; no LLM. Returns the buckets without persisting —
   * the caller can apply each quarter at its own pace via the existing
   * decide + apply endpoints.
   */
  async phaseRemediations(tenantId: string, remediationRunId: string, quarters: number) {
    if (quarters < 1 || quarters > 8) {
      throw new BadRequestException('quarters must be 1..8');
    }
    const run = await this.getRun(tenantId, remediationRunId);
    if (run.agentType !== 'remediation') {
      throw new BadRequestException(
        `Run ${remediationRunId} agentType=${run.agentType}, expected remediation`,
      );
    }
    const rows = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRemediation.findMany({
        where: { tenantId, runId: remediationRunId, status: { in: ['PROPOSED', 'APPROVED'] } },
        orderBy: { createdAt: 'asc' },
      }),
    );

    // Sort by absolute delta DESC so the biggest fixes go first.
    const enriched = rows
      .map((r) => ({
        id: r.id,
        employeeId: r.employeeId,
        fromValue: Number(r.fromValue),
        toValue: Number(r.toValue),
        delta: Number(r.toValue) - Number(r.fromValue),
        status: r.status,
        justification: r.justification,
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const buckets: Array<{
      quarter: number;
      label: string;
      rows: typeof enriched;
      totalCost: number;
      employeeCount: number;
    }> = Array.from({ length: quarters }, (_, i) => ({
      quarter: i + 1,
      label: `Q${i + 1}`,
      rows: [] as typeof enriched,
      totalCost: 0,
      employeeCount: 0,
    }));

    // Round-robin assignment by sorted index → spreads big-to-small evenly.
    enriched.forEach((row, i) => {
      const b = buckets[i % quarters]!;
      b.rows.push(row);
      b.totalCost += row.delta;
      b.employeeCount += 1;
    });

    const totalCost = enriched.reduce((s, r) => s + r.delta, 0);
    return {
      remediationRunId,
      quarters,
      totalCost,
      employeeCount: enriched.length,
      buckets,
    };
  }

  /**
   * Phase 2.6 — Remediation letters.
   *
   * Generates an in-row CompensationLetter record per APPLIED remediation,
   * using the existing Letters module's RAISE letter type. Doesn't actually
   * email — the Letters module owns delivery; this just stages the rows so
   * an HR admin can trigger send from the existing /letters dashboard.
   *
   * Returns the count of letters staged + the IDs.
   */
  async stageRemediationLetters(
    tenantId: string,
    remediationRunId: string,
    userId: string,
  ): Promise<{ stagedCount: number; letterIds: string[] }> {
    const run = await this.getRun(tenantId, remediationRunId);
    if (run.agentType !== 'remediation') {
      throw new BadRequestException(
        `Run ${remediationRunId} agentType=${run.agentType}, expected remediation`,
      );
    }

    return this.db.forTenant(tenantId, async (tx) => {
      const applied = await tx.payEquityRemediation.findMany({
        where: { tenantId, runId: remediationRunId, status: 'APPLIED' },
      });
      if (applied.length === 0) {
        return { stagedCount: 0, letterIds: [] };
      }

      const letterIds: string[] = [];
      for (const r of applied) {
        const employee = await tx.employee.findUnique({
          where: { id: r.employeeId },
          select: {
            firstName: true,
            lastName: true,
            email: true,
            level: true,
            department: true,
            currency: true,
          },
        });
        if (!employee) continue;

        const fromValue = Number(r.fromValue);
        const toValue = Number(r.toValue);
        const letter = await tx.compensationLetter.create({
          data: {
            tenantId,
            userId,
            employeeId: r.employeeId,
            letterType: 'RAISE',
            status: 'DRAFT',
            subject: 'Compensation adjustment — pay equity',
            content: '',
            compData: {
              fromValue,
              toValue,
              delta: toValue - fromValue,
              currency: employee.currency,
              justification:
                r.justification ?? 'Pay equity adjustment to align with cohort midpoint.',
            } as unknown as Prisma.InputJsonValue,
            metadata: {
              source: 'pay_equity_remediation',
              remediationId: r.id,
              remediationRunId,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        letterIds.push(letter.id);
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'PAY_EQUITY_REMEDIATION_LETTERS_STAGED',
          entityType: 'PayEquityRun',
          entityId: remediationRunId,
          changes: {
            stagedCount: letterIds.length,
            appliedCount: applied.length,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.log(`Staged ${letterIds.length} remediation letters for run ${remediationRunId}`);

      return { stagedCount: letterIds.length, letterIds };
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
    options: { employeeId?: string } = {},
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

    // Defensibility export needs the full audit trail + child agent runs.
    let auditTrail: Awaited<ReturnType<typeof this.getAuditTrail>>['events'] = [];
    let childRuns: Awaited<ReturnType<typeof this.getMethodology>>['agentInvocations'] = [];
    if (type === 'defensibility') {
      const trail = await this.getAuditTrail(tenantId, runId);
      auditTrail = trail.events;
      const meth = await this.getMethodology(tenantId, runId);
      childRuns = meth.agentInvocations;
    }

    // Employee statement (Phase 6.1) needs a specific employee row.
    let employeeCtx: Parameters<typeof renderReport>[1]['employee'];
    if (type === 'employee_statement') {
      if (!options.employeeId) {
        throw new BadRequestException('employee_statement requires an employeeId');
      }
      const emp = await this.db.forTenant(tenantId, (tx) =>
        tx.employee.findFirst({
          where: { id: options.employeeId, tenantId },
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            level: true,
            department: true,
            compaRatio: true,
            baseSalary: true,
            currency: true,
          },
        }),
      );
      if (!emp) throw new BadRequestException(`Employee ${options.employeeId} not found`);
      employeeCtx = {
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        firstName: emp.firstName,
        lastName: emp.lastName,
        level: emp.level,
        department: emp.department,
        compaRatio: emp.compaRatio === null ? null : Number(emp.compaRatio),
        baseSalary: Number(emp.baseSalary),
        currency: emp.currency,
      };
    }

    const out = renderReport(type, {
      runId,
      runAt: run.createdAt,
      tenantId,
      tenantName: tenant?.name ?? 'Company',
      envelope,
      auditTrail,
      childRuns,
      employee: employeeCtx,
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

  // ─── Phase 4 — Predict ──────────────────────────────────────────

  /**
   * Forward-looking gap projection.
   *
   * - Loads the most recent N narrative runs as historical anchor (oldest→newest)
   * - Computes the deterministic projected series via linear extrapolation
   *   of the worst-cohort gap, optionally adjusted by scenario inputs
   *   (hiring plan widens or closes gap based on group balance at level;
   *   promotion plan moves cohort employees to new level)
   * - Invokes the projection LLM agent for narrative + drivers + actions
   *   (numbers come from the deterministic series, not the LLM)
   * - Persists a child PayEquityRun row (agentType=projection)
   * - Writes an AuditLog row per invocation
   */
  async forecastProjection(
    tenantId: string,
    userId: string,
    scenario: {
      scenarioLabel?: string;
      horizonMonths?: number;
      hiringPlan?: Array<{
        level: string;
        dimension: string;
        group: string;
        count: number;
        meanSalary: number;
      }>;
      promotionPlan?: Array<{
        cohort: { dimension: string; group: string };
        employees: number;
        toLevel: string;
      }>;
    },
  ): Promise<{ runId: string; envelope: PayEquityAgentResult<GapProjectionOutput> }> {
    const horizonMonths = scenario.horizonMonths ?? 12;
    const hiringPlan = scenario.hiringPlan ?? [];
    const promotionPlan = scenario.promotionPlan ?? [];
    const scenarioLabel =
      scenario.scenarioLabel ??
      (hiringPlan.length === 0 && promotionPlan.length === 0
        ? 'Status quo (no scenario adjustments)'
        : 'Custom hiring + promotion scenario');

    // ── Historical anchor — last 6 narrative runs ────────────────
    const recentRunsRows = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.findMany({
        where: { tenantId, agentType: 'narrative', status: 'COMPLETE' },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          createdAt: true,
          sampleSize: true,
          methodologyVersion: true,
          result: true,
        },
      }),
    );

    const recentRuns = recentRunsRows
      .map((r) => {
        const env = r.result as unknown as PayEquityAgentResult<{
          regressionResults: Array<{ gapPercent: number; significance: string }>;
        }>;
        const regs = env.output.regressionResults;
        if (!regs || regs.length === 0) return null;
        const worst = regs.reduce(
          (a, b) => (Math.abs(a.gapPercent) > Math.abs(b.gapPercent) ? a : b),
          regs[0]!,
        );
        return {
          runAt: r.createdAt.toISOString(),
          gapPercent: Math.abs(worst.gapPercent),
          significantCount: regs.filter((x) => x.significance === 'significant').length,
          sampleSize: r.sampleSize ?? 0,
          methodologyVersion: r.methodologyVersion,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .reverse(); // oldest → newest

    if (recentRuns.length === 0) {
      throw new BadRequestException(
        'No completed narrative runs available — run an analysis from the Overview tab first.',
      );
    }

    // ── Deterministic forecast (linear extrapolation + scenario adjustment) ──
    const baselineGap = recentRuns[recentRuns.length - 1]!.gapPercent;
    const slopePerMonth = computeMonthlySlope(recentRuns);
    // Composition math: scenario impact is the share-weighted reach of new
    // hires/promotions relative to the current cohort, NOT a flat per-employee
    // constant. See computeScenarioGapDelta for the full derivation.
    const cohortSize = recentRuns[recentRuns.length - 1]!.sampleSize ?? 0;
    const scenarioAdjustment = computeScenarioGapDelta(
      hiringPlan,
      promotionPlan,
      cohortSize,
      baselineGap,
    );

    const checkpoints = uniqueSorted([1, 3, 6, horizonMonths]);
    const projectedSeries = checkpoints.map((m) => {
      const trend = baselineGap + slopePerMonth * m;
      const scenarioFraction = horizonMonths > 0 ? m / horizonMonths : 0;
      return {
        monthsFromNow: m,
        projectedGapPercent: round2(trend + scenarioAdjustment * scenarioFraction),
      };
    });
    const projectedGap = projectedSeries[projectedSeries.length - 1]!.projectedGapPercent;
    // 95% CI from observed run-to-run variance (fallback ±1pp).
    const sigma = recentRuns.length >= 3 ? observedSigma(recentRuns) : 1;
    const confidenceLow = round2(projectedGap - 1.96 * sigma);
    const confidenceHigh = round2(projectedGap + 1.96 * sigma);

    // Pre-create a child PayEquityRun so we have a runId even if the agent fails.
    const parentMethodology = recentRunsRows[0]!.methodologyVersion;
    const pendingRun = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.create({
        data: {
          tenantId,
          userId,
          agentType: 'projection',
          methodologyName: PayEquityV2Service.METHODOLOGY_NAME,
          methodologyVersion: parentMethodology,
          controls: [],
          status: 'PENDING',
          summary: scenarioLabel,
        },
      }),
    );

    try {
      const envelope = await invokeProjectionGraph({
        tenantId,
        userId,
        scenarioLabel,
        recentRuns,
        projectedSeries,
        baselineGap: round2(baselineGap),
        projectedGap,
        confidenceLow,
        confidenceHigh,
        scenario: { horizonMonths, hiringPlan, promotionPlan },
        methodology: {
          name: PayEquityV2Service.METHODOLOGY_NAME,
          version: parentMethodology,
          controls: [],
          sampleSize: recentRuns[recentRuns.length - 1]!.sampleSize,
        },
      });
      envelope.runId = pendingRun.id;

      await this.db.forTenant(tenantId, async (tx) => {
        await tx.payEquityRun.update({
          where: { id: pendingRun.id },
          data: {
            status: 'COMPLETE',
            sampleSize: recentRuns[recentRuns.length - 1]!.sampleSize,
            result: envelope as unknown as Prisma.InputJsonValue,
            summary: `${scenarioLabel}: ${baselineGap.toFixed(1)}% → ${projectedGap.toFixed(1)}% over ${horizonMonths}mo`,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'PAY_EQUITY_PROJECTION',
            entityType: 'PayEquityRun',
            entityId: pendingRun.id,
            changes: {
              scenarioLabel,
              horizonMonths,
              baselineGap: round2(baselineGap),
              projectedGap,
              hiringPlanCount: hiringPlan.length,
              promotionPlanCount: promotionPlan.length,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      });

      this.logger.log(
        `Projection: child=${pendingRun.id} baseline=${baselineGap.toFixed(2)} projected=${projectedGap.toFixed(2)} horizon=${horizonMonths}mo`,
      );
      return { runId: pendingRun.id, envelope };
    } catch (err) {
      this.logger.error(`Projection failed for ${pendingRun.id}`, err);
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

  /**
   * AIR (Adverse Impact Ratio / 80% rule) — read-only computation on a run.
   *
   * Per cohort: AIR = (selection rate of subgroup) / (selection rate of
   * majority/reference group). The 80% rule flags AIR < 0.8 as adverse
   * impact. We model "selection rate" as the share of the cohort that is
   * paid above the reference-group median (proxied by sign of regression
   * coefficient on the protected class indicator).
   *
   * No persistence — like trend / cohort matrix. Called inline by the UI.
   */
  async getAirAnalysis(tenantId: string, runId: string) {
    const run = await this.getRun(tenantId, runId);
    if (run.status !== 'COMPLETE') {
      throw new BadRequestException(`Run ${runId} is ${run.status}, AIR unavailable`);
    }
    const env = run.result as unknown as PayEquityAgentResult<{
      regressionResults: Array<{
        dimension: string;
        group: string;
        referenceGroup: string;
        coefficient: number;
        sampleSize: number;
        gapPercent: number;
        significance: string;
      }>;
    }>;

    const cohorts = env.output.regressionResults.map((r) => {
      // Map regression coefficient β to a relative selection rate.
      // β=0 → AIR=1; negative β (lower pay than reference) → AIR<1.
      const air = round2(Math.exp(r.coefficient));
      const pass = air >= 0.8;
      return {
        dimension: r.dimension,
        group: r.group,
        referenceGroup: r.referenceGroup,
        sampleSize: r.sampleSize,
        gapPercent: round2(r.gapPercent),
        adverseImpactRatio: air,
        passesEightyPercentRule: pass,
        severity: !pass && r.significance === 'significant' ? 'high' : pass ? 'low' : 'medium',
      };
    });

    const failingCount = cohorts.filter((c) => !c.passesEightyPercentRule).length;

    return {
      runId,
      runAt: run.createdAt,
      methodology: `${run.methodologyName}@${run.methodologyVersion}`,
      threshold: 0.8,
      cohorts,
      summary: {
        total: cohorts.length,
        passing: cohorts.length - failingCount,
        failing: failingCount,
      },
    };
  }

  // ─── Phase 5 — Trust ──────────────────────────────────────────────

  /**
   * Methodology snapshot for a single run — what the model did, what it
   * controlled for, what threshold it claimed, and which agents touched it.
   *
   * Read-only; no persistence. Powers the methodology card on Overview and
   * the methodology section of the defensibility export.
   */
  async getMethodology(tenantId: string, runId: string) {
    const run = await this.getRun(tenantId, runId);
    const env = run.result as unknown as PayEquityAgentResult<{
      regressionResults: Array<{
        dimension: string;
        coefficient: number;
        pValue: number;
        sampleSize: number;
        significance: string;
      }>;
      overallStats?: { totalEmployees: number; rSquared?: number; adjustedRSquared?: number };
      controlVariables?: string[];
    } | null> | null;

    const controls =
      env?.methodology?.controls ?? env?.output?.controlVariables ?? run.controls ?? [];

    // Find every child run that branched off this parent (cohort root-cause,
    // outlier explainer, remediation, projection). Each child counts as an
    // "agent invocation" the methodology snapshot lists.
    const children = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.findMany({
        where: {
          tenantId,
          // Child runs reference parent via summary/audit; we surface them by
          // looking at child runs created after this one with non-narrative
          // agentType. The cleanest signal is the audit log; we read both.
          NOT: { agentType: 'narrative' },
          createdAt: { gte: run.createdAt },
        },
        select: {
          id: true,
          agentType: true,
          status: true,
          summary: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
    );

    const significantCount =
      env?.output?.regressionResults?.filter((r) => r.significance === 'significant').length ?? 0;

    return {
      runId,
      runAt: run.createdAt,
      tenantId,
      methodology: {
        name: run.methodologyName,
        version: run.methodologyVersion,
        fullName: `${run.methodologyName}@${run.methodologyVersion}`,
        controls,
        dependentVariable: env?.methodology?.dependentVariable ?? 'log_salary',
        sampleSize: env?.methodology?.sampleSize ?? run.sampleSize ?? 0,
        confidenceInterval: env?.methodology?.confidenceInterval ?? 0.95,
        complianceThreshold: env?.methodology?.complianceThreshold ?? null,
      },
      headline: {
        cohortsEvaluated: env?.output?.regressionResults?.length ?? 0,
        significantGaps: significantCount,
        totalEmployees: env?.output?.overallStats?.totalEmployees ?? 0,
        rSquared: env?.output?.overallStats?.rSquared ?? null,
        adjustedRSquared: env?.output?.overallStats?.adjustedRSquared ?? null,
        confidence: env?.confidence ?? null,
        warnings: env?.warnings ?? [],
      },
      agentInvocations: children.map((c) => ({
        runId: c.id,
        agentType: c.agentType,
        status: c.status,
        summary: c.summary,
        createdAt: c.createdAt,
      })),
      citationCount: env?.citations?.length ?? 0,
    };
  }

  /**
   * Audit trail surfaced for a single run. Returns every AuditLog row that
   * touches this run id — the run itself plus every child agent invocation
   * (cohort root-cause, outlier explainer, remediation, projection, report
   * export) plus per-employee remediation events linked back through the
   * remediation rows.
   *
   * Read-only; no persistence.
   */
  async getAuditTrail(tenantId: string, runId: string) {
    await this.getRun(tenantId, runId); // 404 if not visible

    const trail = await this.db.forTenant(tenantId, async (tx) => {
      // Collect related entity ids: this run + child runs whose entityId
      // points back, plus remediation rows whose runId matches a remediation
      // child run.
      const childRuns = await tx.payEquityRun.findMany({
        where: { tenantId, NOT: { agentType: 'narrative' } },
        select: { id: true, agentType: true },
      });

      const remediationRunIds = childRuns
        .filter((r) => r.agentType === 'remediation')
        .map((r) => r.id);

      const remediations = await tx.payEquityRemediation.findMany({
        where: { tenantId, runId: { in: remediationRunIds } },
        select: { id: true, runId: true },
      });
      const remediationIds = remediations.map((r) => r.id);

      // Pull audit rows: anything tagged to PayEquityRun (this id or any
      // child) or to a remediation row from one of our remediation runs.
      const allRunIds = [runId, ...childRuns.map((c) => c.id)];
      const rows = await tx.auditLog.findMany({
        where: {
          tenantId,
          OR: [
            { entityType: 'PayEquityRun', entityId: { in: allRunIds } },
            { entityType: 'Employee', entityId: { in: remediationIds } },
            // Remediation per-row decisions reference the remediation id as entityId
            { action: { startsWith: 'PAY_EQUITY_' } },
          ],
        },
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          userId: true,
          changes: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      return rows;
    });

    return {
      runId,
      total: trail.length,
      events: trail,
    };
  }

  // ─── Phase 6.3 — Manager Equity Copilot ──────────────────────────

  /**
   * Bounded-scope Q&A for managers.
   *
   * - Resolves the asking user's Employee row by email
   * - Loads their direct reports as the team-scope source of truth
   * - Pulls the latest narrative run as the org-scope source of truth
   * - Invokes the copilot LLM agent (numbers come from input, not the LLM)
   * - Persists a child PayEquityRun (agentType=copilot) + AuditLog
   *
   * Out-of-scope questions are refused by the agent itself; the service
   * provides the bounded inputs and trusts the prompt contract.
   */
  async askCopilot(
    tenantId: string,
    userId: string,
    user: { email: string; name?: string },
    question: string,
  ): Promise<{ runId: string; envelope: PayEquityAgentResult<CopilotOutput> }> {
    // ── Resolve manager → Employee by email (within tenant) ─────
    const managerEmployee = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.findFirst({
        where: { tenantId, email: user.email },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          level: true,
          department: true,
        },
      }),
    );

    // ── Direct reports (team scope) ─────────────────────────────
    const team = managerEmployee
      ? await this.db.forTenant(tenantId, (tx) =>
          tx.employee.findMany({
            where: { tenantId, managerId: managerEmployee.id, terminationDate: null },
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              level: true,
              department: true,
              gender: true,
              compaRatio: true,
              baseSalary: true,
              currency: true,
            },
            take: 50,
          }),
        )
      : [];

    // ── Latest narrative run (org scope) ────────────────────────
    const latestRun = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.findFirst({
        where: { tenantId, agentType: 'narrative', status: 'COMPLETE' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          sampleSize: true,
          methodologyName: true,
          methodologyVersion: true,
          result: true,
        },
      }),
    );

    let orgState: Parameters<typeof invokePayEquityCopilotGraph>[0]['orgState'] = {
      runId: null,
      runAt: null,
      methodology: null,
      sampleSize: 0,
      significantGaps: 0,
      worstCohort: null,
      confidence: null,
    };
    if (latestRun) {
      const env = latestRun.result as unknown as PayEquityAgentResult<{
        regressionResults: Array<{
          dimension: string;
          group: string;
          gapPercent: number;
          significance: string;
        }>;
      }>;
      const regs = env.output.regressionResults ?? [];
      const sigCount = regs.filter((r) => r.significance === 'significant').length;
      const worst = regs.reduce(
        (a, b) => (Math.abs(a?.gapPercent ?? 0) > Math.abs(b.gapPercent) ? a : b),
        regs[0],
      );
      orgState = {
        runId: latestRun.id,
        runAt: latestRun.createdAt.toISOString(),
        methodology: `${latestRun.methodologyName}@${latestRun.methodologyVersion}`,
        sampleSize: latestRun.sampleSize ?? 0,
        significantGaps: sigCount,
        worstCohort: worst
          ? {
              dimension: worst.dimension,
              group: worst.group,
              gapPercent: worst.gapPercent,
            }
          : null,
        confidence: env.confidence ?? null,
      };
    }

    // ── Pre-create child PayEquityRun row ──────────────────────
    const pendingRun = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.create({
        data: {
          tenantId,
          userId,
          agentType: 'copilot',
          methodologyName: PayEquityV2Service.METHODOLOGY_NAME,
          methodologyVersion:
            latestRun?.methodologyVersion ?? PayEquityV2Service.METHODOLOGY_VERSION,
          controls: [],
          status: 'PENDING',
          summary: question.slice(0, 200),
        },
      }),
    );

    try {
      const envelope = await invokePayEquityCopilotGraph({
        tenantId,
        userId,
        question,
        manager: {
          employeeId: managerEmployee?.id ?? null,
          name:
            user.name ??
            (`${managerEmployee?.firstName ?? ''} ${managerEmployee?.lastName ?? ''}`.trim() ||
              user.email),
          email: user.email,
          level: managerEmployee?.level ?? null,
          department: managerEmployee?.department ?? null,
        },
        team: team.map((e) => ({
          employeeId: e.id,
          employeeCode: e.employeeCode,
          firstName: e.firstName,
          lastName: e.lastName,
          level: e.level,
          department: e.department,
          gender: e.gender,
          compaRatio: e.compaRatio === null ? null : Number(e.compaRatio),
          baseSalary: Number(e.baseSalary),
          currency: e.currency,
        })),
        orgState,
        methodology: {
          name: PayEquityV2Service.METHODOLOGY_NAME,
          version: latestRun?.methodologyVersion ?? PayEquityV2Service.METHODOLOGY_VERSION,
          controls: [],
          sampleSize: orgState.sampleSize,
        },
      });
      envelope.runId = pendingRun.id;

      await this.db.forTenant(tenantId, async (tx) => {
        await tx.payEquityRun.update({
          where: { id: pendingRun.id },
          data: {
            status: 'COMPLETE',
            sampleSize: team.length,
            result: envelope as unknown as Prisma.InputJsonValue,
            summary: envelope.output.refused
              ? `Refused: ${envelope.output.refusalReason ?? 'out of scope'}`
              : `Q: ${question.slice(0, 80)} · scope=${envelope.output.scope}`,
          },
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'PAY_EQUITY_COPILOT',
            entityType: 'PayEquityRun',
            entityId: pendingRun.id,
            changes: {
              question: question.slice(0, 200),
              scope: envelope.output.scope,
              refused: envelope.output.refused,
              teamSize: team.length,
              managerEmail: user.email,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      });

      this.logger.log(
        `Copilot: child=${pendingRun.id} scope=${envelope.output.scope} refused=${envelope.output.refused} team=${team.length}`,
      );
      return { runId: pendingRun.id, envelope };
    } catch (err) {
      this.logger.error(`Copilot failed for ${pendingRun.id}`, err);
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

  // ─── Phase 6.2 — Pay range publication ──────────────────────────

  /**
   * Returns the tenant's salary bands grouped by job family + level for
   * publication on jurisdictions that mandate it (CA SB 1162, NY Local Law 32,
   * CO Equal Pay Act, EU PTD pre-employment range disclosure).
   *
   * Read-only; bands are sourced from the existing `salary_bands` table.
   * Filters: only bands that haven't expired and (optionally) match the
   * jurisdiction's required disclosure shape.
   */
  async getPayRanges(tenantId: string) {
    const now = new Date();
    const bands = await this.db.forTenant(tenantId, (tx) =>
      tx.salaryBand.findMany({
        where: {
          tenantId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: [{ jobFamily: 'asc' }, { level: 'asc' }, { location: 'asc' }],
        select: {
          id: true,
          jobFamily: true,
          level: true,
          location: true,
          currency: true,
          p10: true,
          p25: true,
          p50: true,
          p75: true,
          p90: true,
          effectiveDate: true,
        },
      }),
    );

    return {
      tenantId,
      generatedAt: now.toISOString(),
      total: bands.length,
      ranges: bands.map((b) => ({
        id: b.id,
        jobFamily: b.jobFamily,
        level: b.level,
        location: b.location,
        currency: b.currency,
        // Most jurisdictions require min..max; we publish p25..p75 as the
        // posting range (excludes outliers in either direction). p50 is the
        // midpoint anchor.
        rangeMin: Number(b.p25),
        rangeMid: Number(b.p50),
        rangeMax: Number(b.p75),
        // Full distribution available for jurisdictions that want it.
        distribution: {
          p10: Number(b.p10),
          p25: Number(b.p25),
          p50: Number(b.p50),
          p75: Number(b.p75),
          p90: Number(b.p90),
        },
        effectiveDate: b.effectiveDate,
      })),
    };
  }

  // ─── Phase 4 — Prevent half ─────────────────────────────────────

  /**
   * Pay band drift detector (4.4).
   *
   * Detects whether salaries are lagging the salary bands by comparing the
   * mean compa-ratio across the last N narrative runs. Falling CR over time
   * = bands are outpacing salaries (drift). Rising CR = the opposite. No
   * new schema needed; uses the immutable run envelopes.
   */
  async getBandDrift(tenantId: string) {
    const runs = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.findMany({
        where: { tenantId, agentType: 'narrative', status: 'COMPLETE' },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, createdAt: true, sampleSize: true, result: true },
      }),
    );

    if (runs.length === 0) {
      return {
        hasData: false as const,
        message: 'No completed narrative runs yet — band drift unavailable.',
      };
    }

    const series = runs
      .map((r) => {
        const env = r.result as unknown as PayEquityAgentResult<{
          compaRatios?: Array<{ avgCompaRatio: number; count: number }>;
        }>;
        const crs = env.output?.compaRatios ?? [];
        if (crs.length === 0) return null;
        const totalN = crs.reduce((s, c) => s + c.count, 0);
        const weightedMean =
          totalN === 0 ? 0 : crs.reduce((s, c) => s + c.avgCompaRatio * c.count, 0) / totalN;
        return {
          runId: r.id,
          runAt: r.createdAt.toISOString(),
          meanCompaRatio: round2(weightedMean),
          sampleSize: r.sampleSize ?? 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .reverse(); // oldest → newest

    if (series.length < 2) {
      return {
        hasData: true as const,
        series,
        drift: null,
        verdict: 'insufficient_history' as const,
        message: 'Need at least 2 runs to compute band drift.',
      };
    }

    const first = series[0]!.meanCompaRatio;
    const last = series[series.length - 1]!.meanCompaRatio;
    const driftPercent = round2(((last - first) / first) * 100);

    // Drift verdict: CR dropped >2% relative = bands outpacing salaries.
    const verdict: 'bands_outpacing' | 'salaries_outpacing' | 'stable' =
      driftPercent < -2 ? 'bands_outpacing' : driftPercent > 2 ? 'salaries_outpacing' : 'stable';

    return {
      hasData: true as const,
      series,
      drift: {
        firstMeanCompaRatio: first,
        latestMeanCompaRatio: last,
        driftPercent,
        runsCovered: series.length,
      },
      verdict,
      message:
        verdict === 'bands_outpacing'
          ? `Mean compa-ratio fell ${Math.abs(driftPercent).toFixed(1)}% over ${series.length} runs — salaries are lagging market.`
          : verdict === 'salaries_outpacing'
            ? `Mean compa-ratio rose ${driftPercent.toFixed(1)}% over ${series.length} runs — salaries growing faster than bands.`
            : `Mean compa-ratio held within ±2% over ${series.length} runs.`,
    };
  }

  /**
   * Pre-decision equity check (4.3 + 4.6 + 4.7).
   *
   * Takes a hypothetical change set (promotion slate, in-cycle adjustment, or
   * pre-offer salary) and returns a deterministic equity verdict: projected
   * mean compa-ratio shift per affected cohort, flagged employees, and an
   * overall verdict. No persistence; no LLM. Designed to be fast enough to
   * call inline from /comp-cycles/my-team or a recruiter-facing offer flow.
   *
   * Use cases:
   *   kind='promotion' → 4.3 promotion slate equity check
   *   kind='salary_change' → 4.6 in-cycle warning
   *   kind='new_hire' → 4.7 pre-offer guardrail
   */
  async previewChange(
    tenantId: string,
    changes: Array<{
      kind: 'promotion' | 'salary_change' | 'new_hire';
      employeeId?: string;
      fromSalary?: number;
      toSalary: number;
      level?: string;
      dimension?: string; // for new_hire scenarios
      group?: string; // for new_hire scenarios
    }>,
  ) {
    const latestRun = await this.db.forTenant(tenantId, (tx) =>
      tx.payEquityRun.findFirst({
        where: { tenantId, agentType: 'narrative', status: 'COMPLETE' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, result: true },
      }),
    );

    // Pull baseline gap + cohort size from the latest run.
    let baselineGap = 0;
    let cohortSize = 0;
    if (latestRun) {
      const env = latestRun.result as unknown as PayEquityAgentResult<{
        regressionResults: Array<{ gapPercent: number; sampleSize: number }>;
        overallStats?: { totalEmployees?: number };
      }>;
      const regs = env.output.regressionResults ?? [];
      const worst = regs.reduce(
        (a, b) => (Math.abs(a?.gapPercent ?? 0) > Math.abs(b.gapPercent) ? a : b),
        regs[0],
      );
      baselineGap = Math.abs(worst?.gapPercent ?? 0);
      cohortSize = env.output.overallStats?.totalEmployees ?? worst?.sampleSize ?? 0;
    }

    // Composition math (no magic coefficients).
    //
    // For a single new hire or promotion (K=1):
    //   share  = 1 / (N + 1)
    //   impact = share × |gap| × 0.5         (a hire moves one of two group means)
    //   Δ      = sign(group) × impact        (× 1.5 for promotions; level mix shift)
    //
    // For a salary change of an existing employee (in group G):
    //   pctSalaryChange = (toSalary - fromSalary) / fromSalary
    //   groupShare      = N/2 / N            (assumes binary split; conservative)
    //   Δ               = -sign(group) × pctSalaryChange × groupShare × 0.5
    //   (raising the underpaid group narrows the gap; raising the overpaid widens it)
    const N = Math.max(cohortSize, 1);
    const gapMagnitude = Math.max(baselineGap, 1);
    const HIRE_GROUP_REACH = 0.5;
    const PROMOTION_WEIGHT = 1.5;

    const isReferenceGroup = (g: string) =>
      /^m$|^male$|^men$/i.test(g.trim()) || /^white$|^non.?hispanic$/i.test(g.trim());

    // Resolve employees referenced by the changes (need their group / level).
    const employeeIds = changes
      .map((c) => c.employeeId)
      .filter((id): id is string => typeof id === 'string');
    const employees = employeeIds.length
      ? await this.db.forTenant(tenantId, (tx) =>
          tx.employee.findMany({
            where: { tenantId, id: { in: employeeIds } },
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              level: true,
              gender: true,
              baseSalary: true,
              compaRatio: true,
            },
          }),
        )
      : [];
    const empById = new Map(employees.map((e) => [e.id, e]));

    let projectedDelta = 0;
    const flagged: Array<{
      employeeId: string | null;
      employeeCode: string | null;
      kind: string;
      reason: string;
      severity: 'high' | 'medium' | 'low';
    }> = [];

    for (const c of changes) {
      const emp = c.employeeId ? empById.get(c.employeeId) : undefined;
      const group = c.group ?? emp?.gender ?? '';
      const sign = isReferenceGroup(group) ? +1 : -1;

      if (c.kind === 'new_hire') {
        const share = 1 / (N + 1);
        projectedDelta += sign * share * gapMagnitude * HIRE_GROUP_REACH;
      } else if (c.kind === 'promotion') {
        const share = 1 / (N + 1);
        projectedDelta += sign * share * gapMagnitude * HIRE_GROUP_REACH * PROMOTION_WEIGHT;
      } else if (c.kind === 'salary_change') {
        const from = c.fromSalary ?? (emp ? Number(emp.baseSalary) : c.toSalary);
        const pctChange = from === 0 ? 0 : (c.toSalary - from) / from;
        // Approx group share: assume binary cohort split (~N/2 per group).
        // Raising the underpaid group narrows the gap; raising the overpaid widens it.
        const groupShare = 0.5;
        projectedDelta += -sign * pctChange * groupShare * 100 * (1 / N);
      }

      // Flag: post-change salary likely puts employee below 0.85 CR proxy
      if (emp && c.kind === 'salary_change') {
        const cr = emp.compaRatio === null ? null : Number(emp.compaRatio);
        if (cr !== null) {
          const projectedCR = (cr * c.toSalary) / Number(emp.baseSalary);
          if (projectedCR < 0.85) {
            flagged.push({
              employeeId: emp.id,
              employeeCode: emp.employeeCode,
              kind: c.kind,
              reason: `Projected compa-ratio ${projectedCR.toFixed(2)} below 0.85 floor.`,
              severity: 'high',
            });
          }
        }
      }
    }

    projectedDelta = round2(projectedDelta);
    const projectedGap = round2(baselineGap + projectedDelta);
    const verdict: 'safe' | 'warn' | 'block' =
      projectedDelta > 0.5 ? 'block' : projectedDelta > 0.1 ? 'warn' : 'safe';

    return {
      runId: latestRun?.id ?? null,
      runAt: latestRun?.createdAt ?? null,
      changesEvaluated: changes.length,
      baselineGap: round2(baselineGap),
      projectedDelta,
      projectedGap,
      verdict,
      flagged,
      message:
        verdict === 'block'
          ? `These changes would widen the worst-cohort gap by ${projectedDelta.toFixed(2)}pp (${baselineGap.toFixed(1)}% → ${projectedGap.toFixed(1)}%). Review before applying.`
          : verdict === 'warn'
            ? `Modest gap impact: +${projectedDelta.toFixed(2)}pp. Proceed with awareness.`
            : `Equity-safe: change set is within ±0.10pp of current baseline.`,
    };
  }
}

// ─── Phase 4 helpers: deterministic projection math ─────────────────────

function uniqueSorted(arr: number[]): number[] {
  return [...new Set(arr)].sort((a, b) => a - b);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Estimate monthly slope of the gap (in percentage points per month) from
 * recent runs. With <2 runs the slope is 0 (flat extrapolation).
 */
function computeMonthlySlope(runs: Array<{ runAt: string; gapPercent: number }>): number {
  if (runs.length < 2) return 0;
  const first = runs[0]!;
  const last = runs[runs.length - 1]!;
  const months =
    (new Date(last.runAt).getTime() - new Date(first.runAt).getTime()) / (30 * 24 * 60 * 60 * 1000);
  if (months <= 0) return 0;
  return (last.gapPercent - first.gapPercent) / months;
}

/**
 * Total gap delta (percentage points) the scenario applies over the full
 * horizon. Positive = widens gap, negative = closes it.
 *
 * Composition math (no magic coefficients — derives the impact from inputs).
 *
 * For a hiring plan with K new hires in group G:
 *   share = K / (N + K)               // new hires' fraction of the new cohort
 *   impact = share × |currentGap|     // gap shifts proportional to current gap magnitude
 *   sign  = +1 if G is the reference (concentrates), -1 if G is the minority (rebalances)
 *   Δ_hire = sign × impact × 0.5      // 0.5 = a hire only moves one group's mean
 *
 * For a promotion plan with K employees moving up:
 *   Same share/impact math, but PROMOTION_WEIGHT (1.5) reflects that level mix
 *   shifts compound — a promoted employee is now in the high-pay tail of their
 *   group, not just an additional headcount. Capped at 2× the hire impact.
 *
 * Why this is more defensible than the old fixed coefficients:
 *   - Scales with cohort size: 50 hires in a 100-person cohort matter more than
 *     50 hires in a 10,000-person cohort. Old model treated them identically.
 *   - Scales with current gap: scenarios on a 1% gap and a 15% gap shift by
 *     proportionally different amounts. Same.
 *   - No external coefficient — the math is fully derivable from N + currentGap +
 *     scenario size, all of which are in the run envelope.
 *
 * Capped at ±15pp total so absurd inputs (e.g. 100k hires) don't produce
 * implausible projections.
 */
function computeScenarioGapDelta(
  hiringPlan: Array<{ dimension: string; group: string; count: number }>,
  promotionPlan: Array<{ cohort: { dimension: string; group: string }; employees: number }>,
  cohortSize: number,
  currentGapPercent: number,
): number {
  // Effective cohort size — fall back to the scenario size + a defensive
  // floor when no historical run is available.
  const N = Math.max(cohortSize, 1);
  // Use absolute gap magnitude as the impact ceiling — direction (widen vs
  // narrow) comes from the group sign, not the gap's sign.
  const gapMagnitude = Math.max(Math.abs(currentGapPercent), 1);

  const HIRE_GROUP_REACH = 0.5; // a hire moves one of two group means
  const PROMOTION_WEIGHT = 1.5; // promotions shift level mix in addition to mean

  // Reference groups widen the gap; minority groups close it. Without raw
  // data on which is the actual reference (would need the legacy analyzer's
  // group ordering), treat the conventional "majority" labels as the
  // reference. Matches what the regression's referenceGroup field actually
  // contains for the existing analyzer.
  const isReferenceGroup = (g: string) =>
    /^m$|^male$|^men$/i.test(g.trim()) || /^white$|^non.?hispanic$/i.test(g.trim());

  let delta = 0;

  for (const h of hiringPlan) {
    const K = h.count;
    const share = K / (N + K);
    const impact = share * gapMagnitude * HIRE_GROUP_REACH;
    delta += (isReferenceGroup(h.group) ? +1 : -1) * impact;
  }

  for (const p of promotionPlan) {
    const K = p.employees;
    const share = K / (N + K);
    const impact = share * gapMagnitude * HIRE_GROUP_REACH * PROMOTION_WEIGHT;
    delta += (isReferenceGroup(p.cohort.group) ? +1 : -1) * impact;
  }

  // Cap so a single absurd input can't dominate the projection.
  const CAP = 15;
  if (delta > CAP) delta = CAP;
  if (delta < -CAP) delta = -CAP;

  return round2(delta);
}

function observedSigma(runs: Array<{ gapPercent: number }>): number {
  if (runs.length < 2) return 1;
  const mean = runs.reduce((s, r) => s + r.gapPercent, 0) / runs.length;
  const variance = runs.reduce((s, r) => s + (r.gapPercent - mean) ** 2, 0) / (runs.length - 1);
  return Math.sqrt(variance);
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
