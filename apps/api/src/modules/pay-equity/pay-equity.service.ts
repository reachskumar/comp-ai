import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
}
