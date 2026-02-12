import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database';

// ─── Types ──────────────────────────────────────────────────

/** A single step in the trace chain */
export interface TraceStep {
  order: number;
  type: 'DATA_CHANGE' | 'RULE_APPLIED' | 'RECOMMENDATION' | 'APPROVAL' | 'PAYROLL_IMPACT';
  timestamp: Date;
  actor: string | null;
  action: string;
  details: Record<string, unknown>;
  beforeValue: string | null;
  afterValue: string | null;
  explanation: string;
}

/** Full trace report for an employee in a payroll run */
export interface TraceReport {
  payrollRunId: string;
  employeeId: string;
  employeeName: string;
  period: string;
  component: string | null;
  generatedAt: Date;
  steps: TraceStep[];
  summary: string;
  isComplete: boolean;
  warnings: string[];
}

// ─── Helpers ────────────────────────────────────────────────

function formatCurrency(value: number | string | null | undefined): string {
  if (value == null) return 'N/A';
  const num = typeof value === 'number' ? value : Number(value);
  if (isNaN(num)) return 'N/A';
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return 'unknown date';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function recTypeLabel(recType: string): string {
  const labels: Record<string, string> = {
    MERIT_INCREASE: 'merit increase',
    BONUS: 'bonus',
    LTI_GRANT: 'LTI grant',
    PROMOTION: 'promotion',
    ADJUSTMENT: 'adjustment',
  };
  return labels[recType] ?? recType.toLowerCase().replace(/_/g, ' ');
}

function pctChange(before: number | string, after: number | string): string {
  const b = Number(before);
  const a = Number(after);
  if (b === 0) return a === 0 ? '0%' : 'N/A';
  const pct = ((a - b) / b) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

// ─── Service ────────────────────────────────────────────────

@Injectable()
export class TraceabilityService {
  private readonly logger = new Logger(TraceabilityService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Build a full trace report for an employee in a payroll run.
   * Optionally filter to a specific component.
   */
  async traceEmployee(
    tenantId: string,
    payrollRunId: string,
    employeeId: string,
    component?: string,
  ): Promise<TraceReport> {
    // 1. Validate payroll run
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payrollRun = await (this.db.client as any).payrollRun.findFirst({
      where: { id: payrollRunId, tenantId },
    });
    if (!payrollRun) {
      throw new NotFoundException(`Payroll run ${payrollRunId} not found`);
    }

    // 2. Validate employee
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const employee = await (this.db.client as any).employee.findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee ${employeeId} not found`);
    }

    const employeeName = `${employee.firstName} ${employee.lastName}`;
    const warnings: string[] = [];
    const steps: TraceStep[] = [];
    let order = 0;

    // 3. Get payroll line items for this employee in this run
    const lineItemWhere: Record<string, unknown> = {
      payrollRunId,
      employeeId,
    };
    if (component) {
      lineItemWhere['component'] = component;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineItems = await (this.db.client as any).payrollLineItem.findMany({
      where: lineItemWhere,
      orderBy: { createdAt: 'asc' },
    });

    if (lineItems.length === 0) {
      warnings.push('No payroll line items found for this employee in this run');
    }

    // 4. Get audit logs for this employee (data changes)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auditLogs = await (this.db.client as any).auditLog.findMany({
      where: {
        tenantId,
        entityType: 'Employee',
        entityId: employeeId,
      },
      orderBy: { createdAt: 'asc' },
      include: { user: true },
    });

    // Build data change steps
    for (const log of auditLogs) {
      const changes = log.changes as Record<string, unknown> ?? {};
      const actorName = log.user?.name ?? 'System';

      steps.push({
        order: order++,
        type: 'DATA_CHANGE',
        timestamp: log.createdAt,
        actor: actorName,
        action: log.action,
        details: changes,
        beforeValue: this.extractBefore(changes),
        afterValue: this.extractAfter(changes),
        explanation: this.explainDataChange(actorName, log.action, changes, log.createdAt),
      });
    }

    if (auditLogs.length === 0) {
      warnings.push('No audit log entries found for this employee');
    }

    // 5. Get compensation recommendations for this employee
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recommendations = await (this.db.client as any).compRecommendation.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'asc' },
      include: {
        cycle: true,
        approver: true,
      },
    });

    // Filter recommendations by component if specified
    const filteredRecs = component
      ? recommendations.filter((r: Record<string, unknown>) =>
          this.recTypeMatchesComponent(r.recType as string, component))
      : recommendations;

    // Build recommendation + approval steps
    for (const rec of filteredRecs) {
      const cycleName = rec.cycle?.name ?? 'Unknown cycle';
      const typeLabel = recTypeLabel(rec.recType);

      // RULE_APPLIED step (the recommendation itself represents a rule being applied)
      steps.push({
        order: order++,
        type: 'RULE_APPLIED',
        timestamp: rec.createdAt,
        actor: null,
        action: `${typeLabel} recommendation created`,
        details: {
          cycleId: rec.cycleId,
          cycleName,
          recType: rec.recType,
          currentValue: Number(rec.currentValue),
          proposedValue: Number(rec.proposedValue),
          justification: rec.justification,
        },
        beforeValue: formatCurrency(rec.currentValue),
        afterValue: formatCurrency(rec.proposedValue),
        explanation: this.explainRecommendation(rec, cycleName, typeLabel),
      });

      // RECOMMENDATION step
      steps.push({
        order: order++,
        type: 'RECOMMENDATION',
        timestamp: rec.updatedAt ?? rec.createdAt,
        actor: null,
        action: `Recommendation status: ${rec.status}`,
        details: {
          status: rec.status,
          recType: rec.recType,
          justification: rec.justification,
        },
        beforeValue: formatCurrency(rec.currentValue),
        afterValue: formatCurrency(rec.proposedValue),
        explanation: this.explainRecommendationStatus(rec, typeLabel),
      });

      // APPROVAL step (if approved)
      if (rec.approvedAt && rec.approver) {
        steps.push({
          order: order++,
          type: 'APPROVAL',
          timestamp: rec.approvedAt,
          actor: rec.approver.name,
          action: `${typeLabel} approved`,
          details: {
            approverUserId: rec.approverUserId,
            approverName: rec.approver.name,
            approvedAt: rec.approvedAt,
          },
          beforeValue: formatCurrency(rec.currentValue),
          afterValue: formatCurrency(rec.proposedValue),
          explanation: this.explainApproval(rec, typeLabel),
        });
      } else if (rec.status === 'APPROVED' && !rec.approver) {
        warnings.push(`Recommendation ${rec.id} is approved but approver details are missing`);
      }
    }

    if (filteredRecs.length === 0) {
      warnings.push('No compensation recommendations found for this employee');
    }

    // 6. Build payroll impact steps from line items
    for (const item of lineItems) {
      steps.push({
        order: order++,
        type: 'PAYROLL_IMPACT',
        timestamp: item.createdAt,
        actor: null,
        action: `Payroll component: ${item.component}`,
        details: {
          component: item.component,
          amount: Number(item.amount),
          previousAmount: Number(item.previousAmount),
          delta: Number(item.delta),
        },
        beforeValue: formatCurrency(item.previousAmount),
        afterValue: formatCurrency(item.amount),
        explanation: this.explainPayrollImpact(item, employeeName),
      });
    }

    // 7. Sort all steps chronologically
    steps.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    steps.forEach((s, i) => (s.order = i));

    // 8. Determine completeness
    const hasDataChange = steps.some((s) => s.type === 'DATA_CHANGE');
    const hasRecommendation = steps.some((s) => s.type === 'RECOMMENDATION');
    const hasApproval = steps.some((s) => s.type === 'APPROVAL');
    const hasPayrollImpact = steps.some((s) => s.type === 'PAYROLL_IMPACT');
    const isComplete = hasDataChange && hasRecommendation && hasApproval && hasPayrollImpact;

    if (!isComplete) {
      const missing: string[] = [];
      if (!hasDataChange) missing.push('data changes');
      if (!hasRecommendation) missing.push('recommendations');
      if (!hasApproval) missing.push('approvals');
      if (!hasPayrollImpact) missing.push('payroll impact');
      warnings.push(`Incomplete trace chain — missing: ${missing.join(', ')}`);
    }

    // 9. Generate summary
    const summary = this.generateSummary(steps, employeeName, payrollRun.period, component ?? null);

    return {
      payrollRunId,
      employeeId,
      employeeName,
      period: payrollRun.period,
      component: component ?? null,
      generatedAt: new Date(),
      steps,
      summary,
      isComplete,
      warnings,
    };
  }

  // ─── Explanation Generators ─────────────────────────────────

  private explainDataChange(
    actor: string,
    action: string,
    changes: Record<string, unknown>,
    timestamp: Date,
  ): string {
    const dateStr = formatDate(timestamp);
    const fieldChanges = Object.entries(changes)
      .filter(([key]) => key !== 'updatedAt')
      .map(([key, val]) => {
        if (val && typeof val === 'object' && 'before' in (val as Record<string, unknown>) && 'after' in (val as Record<string, unknown>)) {
          const change = val as { before: unknown; after: unknown };
          return `${key} changed from ${JSON.stringify(change.before)} to ${JSON.stringify(change.after)}`;
        }
        return `${key} updated`;
      });

    if (fieldChanges.length === 0) {
      return `${actor} performed "${action}" on ${dateStr}`;
    }
    return `${actor} made changes on ${dateStr}: ${fieldChanges.join('; ')}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private explainRecommendation(rec: any, cycleName: string, typeLabel: string): string {
    const change = pctChange(rec.currentValue, rec.proposedValue);
    const justification = rec.justification ? `, based on: "${rec.justification}"` : '';
    return (
      `A ${typeLabel} of ${change} (${formatCurrency(rec.currentValue)} → ${formatCurrency(rec.proposedValue)}) ` +
      `was recommended in cycle "${cycleName}"${justification}`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private explainRecommendationStatus(rec: any, typeLabel: string): string {
    const statusLabels: Record<string, string> = {
      DRAFT: 'is in draft',
      SUBMITTED: 'has been submitted for review',
      APPROVED: 'has been approved',
      REJECTED: 'was rejected',
      ESCALATED: 'was escalated for further review',
    };
    const statusText = statusLabels[rec.status] ?? `has status "${rec.status}"`;
    return `The ${typeLabel} recommendation ${statusText}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private explainApproval(rec: any, typeLabel: string): string {
    const approverName = rec.approver?.name ?? 'Unknown';
    const dateStr = formatDate(rec.approvedAt);
    const cycleName = rec.cycle?.name ?? 'Unknown cycle';
    return (
      `${typeLabel} of ${formatCurrency(rec.currentValue)} → ${formatCurrency(rec.proposedValue)} ` +
      `approved by ${approverName} on ${dateStr}, per cycle "${cycleName}"`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private explainPayrollImpact(item: any, employeeName: string): string {
    const delta = Number(item.delta);
    if (delta === 0) {
      return `${employeeName}'s ${item.component} remains at ${formatCurrency(item.amount)} (no change)`;
    }
    const direction = delta > 0 ? 'increased' : 'decreased';
    const pct = pctChange(item.previousAmount, item.amount);
    return (
      `${employeeName}'s ${item.component} ${direction} from ${formatCurrency(item.previousAmount)} ` +
      `to ${formatCurrency(item.amount)} (${pct}, delta: ${formatCurrency(Math.abs(delta))})`
    );
  }

  // ─── Summary Generator ─────────────────────────────────────

  private generateSummary(
    steps: TraceStep[],
    employeeName: string,
    period: string,
    component: string | null,
  ): string {
    if (steps.length === 0) {
      return `No trace data available for ${employeeName} in period ${period}`;
    }

    const dataChanges = steps.filter((s) => s.type === 'DATA_CHANGE').length;
    const recommendations = steps.filter((s) => s.type === 'RECOMMENDATION').length;
    const approvals = steps.filter((s) => s.type === 'APPROVAL').length;
    const impacts = steps.filter((s) => s.type === 'PAYROLL_IMPACT').length;

    const componentStr = component ? ` for component "${component}"` : '';
    const parts: string[] = [
      `Trace report for ${employeeName} in period ${period}${componentStr}:`,
    ];

    if (dataChanges > 0) parts.push(`${dataChanges} data change(s)`);
    if (recommendations > 0) parts.push(`${recommendations} recommendation(s)`);
    if (approvals > 0) parts.push(`${approvals} approval(s)`);
    if (impacts > 0) parts.push(`${impacts} payroll impact(s)`);

    // Add the most significant payroll impact
    const impactSteps = steps.filter((s) => s.type === 'PAYROLL_IMPACT');
    if (impactSteps.length > 0) {
      const biggest = impactSteps.reduce((max, s) => {
        const delta = Math.abs(Number((s.details as Record<string, unknown>).delta ?? 0));
        const maxDelta = Math.abs(Number((max.details as Record<string, unknown>).delta ?? 0));
        return delta > maxDelta ? s : max;
      });
      parts.push(`Largest impact: ${biggest.explanation}`);
    }

    return parts.join(' | ');
  }

  // ─── Private Helpers ────────────────────────────────────────

  private extractBefore(changes: Record<string, unknown>): string | null {
    for (const val of Object.values(changes)) {
      if (val && typeof val === 'object' && 'before' in (val as Record<string, unknown>)) {
        return String((val as Record<string, unknown>).before);
      }
    }
    return null;
  }

  private extractAfter(changes: Record<string, unknown>): string | null {
    for (const val of Object.values(changes)) {
      if (val && typeof val === 'object' && 'after' in (val as Record<string, unknown>)) {
        return String((val as Record<string, unknown>).after);
      }
    }
    return null;
  }

  /**
   * Map recommendation types to payroll component names.
   * This is a best-effort heuristic — components may vary by tenant.
   */
  private recTypeMatchesComponent(recType: string, component: string): boolean {
    const normalized = component.toLowerCase();
    const mapping: Record<string, string[]> = {
      MERIT_INCREASE: ['base_salary', 'base salary', 'basesalary', 'merit', 'salary'],
      BONUS: ['bonus', 'variable', 'incentive'],
      LTI_GRANT: ['lti', 'equity', 'stock', 'rsu', 'options'],
      PROMOTION: ['base_salary', 'base salary', 'basesalary', 'promotion', 'salary'],
      ADJUSTMENT: ['adjustment', 'base_salary', 'base salary', 'basesalary', 'salary'],
    };
    const keywords = mapping[recType] ?? [];
    return keywords.some((kw) => normalized.includes(kw));
  }
}

