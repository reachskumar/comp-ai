import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../../database';
import { BudgetDriftService } from './budget-drift.service';
import { PolicyViolationService } from './policy-violation.service';
import { OutlierDetectorService } from './outlier-detector.service';
import type {
  ExecSummary,
  CycleProgress,
  MonitorAlert,
} from './types';

@Injectable()
export class ExecSummaryService {
  private readonly logger = new Logger(ExecSummaryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly budgetDrift: BudgetDriftService,
    private readonly policyViolation: PolicyViolationService,
    private readonly outlierDetector: OutlierDetectorService,
  ) {}

  /**
   * Generate a comprehensive executive summary for a cycle.
   * Aggregates all monitor results into a structured report.
   */
  async generate(
    tenantId: string,
    cycleId: string,
  ): Promise<ExecSummary> {
    const cycle = await this.db.client.compCycle.findFirst({
      where: { id: cycleId, tenantId },
    });

    if (!cycle) {
      throw new Error(`Cycle ${cycleId} not found`);
    }

    // Run all monitors in parallel
    const [budgetStatus, violationResult, outlierResult] = await Promise.all([
      this.budgetDrift.detect(tenantId, cycleId),
      this.policyViolation.detect(tenantId, cycleId),
      this.outlierDetector.detect(tenantId, cycleId),
    ]);

    // Get cycle progress
    const cycleProgress = await this.getCycleProgress(cycleId, cycle);

    // Determine blockers
    const blockers = this.identifyBlockers(
      budgetStatus.exceeded,
      budgetStatus.overallDriftPct,
      violationResult.totalViolations,
      violationResult.bySeverity['CRITICAL'] ?? 0,
      cycleProgress,
    );

    // Generate action items
    const actionItems = this.generateActionItems(
      budgetStatus,
      violationResult,
      outlierResult,
      cycleProgress,
    );

    const summary: ExecSummary = {
      cycleId,
      cycleName: cycle.name,
      generatedAt: new Date().toISOString(),
      budgetStatus,
      topViolations: violationResult.violations.slice(0, 10),
      outlierList: outlierResult.outliers.slice(0, 10),
      cycleProgress,
      blockers,
      actionItems,
    };

    this.logger.log(`Exec summary generated for cycle ${cycleId}`);

    return summary;
  }

  /**
   * Create an alert for the exec summary.
   */
  async createAlert(
    tenantId: string,
    cycleId: string,
    summary: ExecSummary,
  ): Promise<MonitorAlert[]> {
    const alert: MonitorAlert = {
      cycleId,
      alertType: 'EXEC_SUMMARY',
      severity: summary.blockers.length > 0 ? 'HIGH' : 'INFO',
      title: `Executive Summary: ${summary.cycleName}`,
      details: {
        generatedAt: summary.generatedAt,
        budgetDriftPct: summary.budgetStatus.overallDriftPct,
        totalViolations: summary.topViolations.length,
        totalOutliers: summary.outlierList.length,
        completionPct: summary.cycleProgress.completionPct,
        blockerCount: summary.blockers.length,
        actionItemCount: summary.actionItems.length,
      },
    };

    await this.persistAlert(tenantId, alert);
    return [alert];
  }

  /**
   * Generate markdown version of the exec summary for email/export.
   */
  toMarkdown(summary: ExecSummary): string {
    const lines: string[] = [
      `# Executive Summary: ${summary.cycleName}`,
      `*Generated: ${summary.generatedAt}*`,
      '',
      '## Budget Status',
      `- Overall drift: **${summary.budgetStatus.overallDriftPct}%**`,
      `- Threshold: ${summary.budgetStatus.thresholdPct}%`,
      `- Status: ${summary.budgetStatus.exceeded ? '⚠️ EXCEEDED' : '✅ Within limits'}`,
      `- Projected total: $${summary.budgetStatus.projection.projectedTotal.toLocaleString()}`,
      `- Days remaining: ${summary.budgetStatus.projection.daysRemaining}`,
      '',
      '## Cycle Progress',
      `- Status: **${summary.cycleProgress.status}**`,
      `- Completion: ${summary.cycleProgress.completionPct}%`,
      `- Total recommendations: ${summary.cycleProgress.totalRecommendations}`,
      `- Days elapsed: ${summary.cycleProgress.daysElapsed}`,
      `- Days remaining: ${summary.cycleProgress.daysRemaining}`,
      '',
    ];

    if (summary.topViolations.length > 0) {
      lines.push('## Top Policy Violations');
      for (const v of summary.topViolations) {
        lines.push(`- **${v.employeeName}** (${v.department}): ${v.details}`);
      }
      lines.push('');
    }

    if (summary.outlierList.length > 0) {
      lines.push('## Outliers');
      for (const o of summary.outlierList) {
        lines.push(`- **${o.employeeName}** (${o.department}/${o.level}): ${o.details}`);
      }
      lines.push('');
    }

    if (summary.blockers.length > 0) {
      lines.push('## ⚠️ Blockers');
      for (const b of summary.blockers) {
        lines.push(`- ${b}`);
      }
      lines.push('');
    }

    lines.push('## Action Items');
    for (const a of summary.actionItems) {
      lines.push(`- [ ] ${a}`);
    }

    return lines.join('\n');
  }

  private async getCycleProgress(
    cycleId: string,
    cycle: { status: string; startDate: Date; endDate: Date },
  ): Promise<CycleProgress> {
    const recStatusCounts = await this.db.client.compRecommendation.groupBy({
      by: ['status'],
      where: { cycleId },
      _count: { id: true },
    });

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const group of recStatusCounts) {
      byStatus[group.status] = group._count.id;
      total += group._count.id;
    }

    const approved = byStatus['APPROVED'] ?? 0;
    const completionPct = total > 0 ? Math.round((approved / total) * 10000) / 100 : 0;

    const now = new Date();
    const start = new Date(cycle.startDate);
    const end = new Date(cycle.endDate);
    const daysElapsed = Math.max(0, Math.round((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    const daysRemaining = Math.max(0, Math.round((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    return {
      status: cycle.status,
      totalRecommendations: total,
      byStatus,
      completionPct,
      daysElapsed,
      daysRemaining,
    };
  }

  private identifyBlockers(
    budgetExceeded: boolean,
    driftPct: number,
    totalViolations: number,
    criticalViolations: number,
    progress: CycleProgress,
  ): string[] {
    const blockers: string[] = [];

    if (budgetExceeded && Math.abs(driftPct) > 10) {
      blockers.push(`Budget drift is ${driftPct}% — exceeds critical threshold`);
    }

    if (criticalViolations > 0) {
      blockers.push(`${criticalViolations} critical policy violation(s) require immediate attention`);
    }

    if (progress.daysRemaining <= 7 && progress.completionPct < 50) {
      blockers.push(`Only ${progress.daysRemaining} days remaining with ${progress.completionPct}% completion`);
    }

    return blockers;
  }

  private generateActionItems(
    budgetStatus: { exceeded: boolean; departmentDrifts: Array<{ department: string; exceeded: boolean; driftPct: number }> },
    violationResult: { totalViolations: number; bySeverity: Record<string, number> },
    outlierResult: { totalOutliers: number },
    progress: CycleProgress,
  ): string[] {
    const items: string[] = [];

    if (budgetStatus.exceeded) {
      const deptList = budgetStatus.departmentDrifts
        .filter((d) => d.exceeded)
        .map((d) => d.department);
      items.push(`Review budget drift in: ${deptList.join(', ')}`);
    }

    if (violationResult.totalViolations > 0) {
      items.push(`Resolve ${violationResult.totalViolations} policy violation(s)`);
    }

    if ((violationResult.bySeverity['CRITICAL'] ?? 0) > 0) {
      items.push(`Escalate ${violationResult.bySeverity['CRITICAL']} critical violation(s) to HR leadership`);
    }

    if (outlierResult.totalOutliers > 0) {
      items.push(`Review ${outlierResult.totalOutliers} compensation outlier(s)`);
    }

    const pending = (progress.byStatus['DRAFT'] ?? 0) + (progress.byStatus['SUBMITTED'] ?? 0);
    if (pending > 0) {
      items.push(`Process ${pending} pending recommendation(s)`);
    }

    if (items.length === 0) {
      items.push('No immediate action items — cycle is on track');
    }

    return items;
  }

  private async persistAlert(
    tenantId: string,
    alert: MonitorAlert,
  ): Promise<void> {
    const adminUser = await this.db.client.user.findFirst({
      where: { tenantId, role: 'ADMIN' },
      select: { id: true },
    });

    if (!adminUser) {
      this.logger.warn(`No admin user found for tenant ${tenantId}, skipping alert persistence`);
      return;
    }

    await this.db.client.notification.create({
      data: {
        tenantId,
        userId: adminUser.id,
        type: alert.alertType,
        title: alert.title,
        body: `Severity: ${alert.severity}`,
        metadata: {
          cycleId: alert.cycleId,
          alertType: alert.alertType,
          severity: alert.severity,
          ...alert.details,
        } as never,
      },
    });
  }
}

