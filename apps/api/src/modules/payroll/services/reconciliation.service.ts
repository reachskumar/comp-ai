import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from '../../../database';
import { Prisma } from '@compensation/database';
import { AnomalyDetectorService } from './anomaly-detector.service';
import { TraceabilityService, type TraceReport } from './traceability.service';
import type { CreatePayrollDto } from '../dto/create-payroll.dto';
import type { AnomalyQueryDto } from '../dto/payroll-query.dto';

// ─── Types ──────────────────────────────────────────────────

export interface ReconciliationSummary {
  payrollRunId: string;
  period: string;
  status: string;
  totalEmployees: number;
  totalLineItems: number;
  totalGross: number;
  totalNet: number;
  totalAnomalies: number;
  anomaliesBySeverity: Record<string, number>;
  anomaliesByType: Record<string, number>;
  resolvedCount: number;
  unresolvedCount: number;
  totalAmountAtRisk: number;
  hasBlockers: boolean;
}

export interface ReconciliationReport {
  summary: ReconciliationSummary;
  anomalies: unknown[];
  traces: TraceReport[];
  generatedAt: Date;
}

// Threshold for async processing
const ASYNC_THRESHOLD = 50_000;

// ─── Service ────────────────────────────────────────────────

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly anomalyDetector: AnomalyDetectorService,
    private readonly traceability: TraceabilityService,
    @InjectQueue('payroll-reconciliation') private readonly reconciliationQueue: Queue,
  ) {}

  // ─── Create Payroll Run ─────────────────────────────────────

  async createPayrollRun(tenantId: string, dto: CreatePayrollDto) {
    // Create the payroll run
    const run = await this.db.client.payrollRun.create({
      data: {
        tenantId,
        period: dto.period,
        status: 'DRAFT',
        employeeCount: new Set(dto.lineItems.map((li) => li.employeeId)).size,
      },
    });

    // Insert line items in batches
    const batchSize = 1000;
    for (let i = 0; i < dto.lineItems.length; i += batchSize) {
      const batch = dto.lineItems.slice(i, i + batchSize);
      await this.db.client.payrollLineItem.createMany({
        data: batch.map((li) => ({
          payrollRunId: run.id,
          employeeId: li.employeeId,
          component: li.component,
          amount: li.amount,
          previousAmount: li.previousAmount ?? 0,
          delta: li.amount - (li.previousAmount ?? 0),
        })),
      });
    }

    // Update totals
    const totals = await this.computeTotals(run.id);
    const updated = await this.db.client.payrollRun.update({
      where: { id: run.id },
      data: {
        totalGross: totals.gross,
        totalNet: totals.net,
      },
    });

    this.logger.log(`Created payroll run ${run.id} with ${dto.lineItems.length} line items`);
    return updated;
  }

  // ─── Run Reconciliation Check ───────────────────────────────

  async runCheck(payrollRunId: string, tenantId: string) {
    await this.findRun(payrollRunId, tenantId);

    // Count line items to decide sync vs async
    const itemCount = await this.db.client.payrollLineItem.count({
      where: { payrollRunId },
    });

    if (itemCount >= ASYNC_THRESHOLD) {
      // Queue for async processing
      await this.db.client.payrollRun.update({
        where: { id: payrollRunId },
        data: { status: 'PROCESSING' },
      });

      await this.reconciliationQueue.add('reconcile', {
        payrollRunId,
        tenantId,
      });

      this.logger.log(`Queued async reconciliation for run ${payrollRunId} (${itemCount} items)`);
      return {
        payrollRunId,
        status: 'PROCESSING',
        message: `Large payroll (${itemCount} items) queued for async processing`,
        async: true,
      };
    }

    // Synchronous processing
    return this.executeReconciliation(payrollRunId, tenantId);
  }

  /** Execute reconciliation (called sync or from queue processor) */
  async executeReconciliation(payrollRunId: string, tenantId: string) {
    const anomalyReport = await this.anomalyDetector.detectAnomalies(payrollRunId, tenantId);

    // Update run status based on results
    const newStatus = anomalyReport.hasBlockers ? 'REVIEW' : 'REVIEW';
    await this.db.client.payrollRun.update({
      where: { id: payrollRunId },
      data: { status: newStatus },
    });

    this.logger.log(
      `Reconciliation complete for ${payrollRunId}: ${anomalyReport.totalAnomalies} anomalies`,
    );

    return {
      payrollRunId,
      status: newStatus,
      anomalyReport,
      async: false,
    };
  }

  // ─── Get Reconciliation Report ──────────────────────────────

  async getReport(payrollRunId: string, tenantId: string): Promise<ReconciliationReport> {
    const run = await this.findRun(payrollRunId, tenantId);

    // Get anomalies
    const anomalies = await this.db.client.payrollAnomaly.findMany({
      where: { payrollRunId },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });

    // Get line item count
    const lineItemCount = await this.db.client.payrollLineItem.count({
      where: { payrollRunId },
    });

    // Build traces for employees with critical/high anomalies
    const criticalEmployeeIds = [
      ...new Set(
        anomalies
          .filter((a) => a.severity === 'CRITICAL' || a.severity === 'HIGH')
          .map((a) => a.employeeId),
      ),
    ].slice(0, 10); // Limit to 10 traces for performance

    const traces: TraceReport[] = [];
    for (const employeeId of criticalEmployeeIds) {
      try {
        const trace = await this.traceability.traceEmployee(
          tenantId,
          payrollRunId,
          employeeId,
        );
        traces.push(trace);
      } catch (err) {
        this.logger.warn(`Failed to trace employee ${employeeId}: ${err}`);
      }
    }

    // Build severity counts
    const anomaliesBySeverity: Record<string, number> = {};
    const anomaliesByType: Record<string, number> = {};
    let totalAmountAtRisk = 0;

    for (const a of anomalies) {
      anomaliesBySeverity[a.severity] = (anomaliesBySeverity[a.severity] ?? 0) + 1;
      anomaliesByType[a.anomalyType] = (anomaliesByType[a.anomalyType] ?? 0) + 1;
      const details = a.details as Record<string, unknown>;
      if (typeof details.amount === 'number') {
        totalAmountAtRisk += Math.abs(details.amount);
      }
    }

    const resolvedCount = anomalies.filter((a) => a.resolved).length;

    const summary: ReconciliationSummary = {
      payrollRunId,
      period: run.period,
      status: run.status,
      totalEmployees: run.employeeCount,
      totalLineItems: lineItemCount,
      totalGross: Number(run.totalGross),
      totalNet: Number(run.totalNet),
      totalAnomalies: anomalies.length,
      anomaliesBySeverity,
      anomaliesByType,
      resolvedCount,
      unresolvedCount: anomalies.length - resolvedCount,
      totalAmountAtRisk,
      hasBlockers: (anomaliesBySeverity['CRITICAL'] ?? 0) > 0,
    };

    return {
      summary,
      anomalies,
      traces,
      generatedAt: new Date(),
    };
  }

  // ─── List Anomalies (Paginated) ────────────────────────────

  async listAnomalies(payrollRunId: string, tenantId: string, query: AnomalyQueryDto) {
    await this.findRun(payrollRunId, tenantId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { payrollRunId };
    if (query.anomalyType) where.anomalyType = query.anomalyType;
    if (query.severity) where.severity = query.severity;
    if (query.resolved !== undefined) where.resolved = query.resolved === 'true';

    const [anomalies, total] = await Promise.all([
      this.db.client.payrollAnomaly.findMany({
        where,
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.db.client.payrollAnomaly.count({ where }),
    ]);

    return {
      data: anomalies,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Resolve Anomaly ───────────────────────────────────────

  async resolveAnomaly(
    payrollRunId: string,
    anomalyId: string,
    tenantId: string,
    userId: string,
    resolutionNotes: string,
  ) {
    await this.findRun(payrollRunId, tenantId);

    const anomaly = await this.db.client.payrollAnomaly.findFirst({
      where: { id: anomalyId, payrollRunId },
    });
    if (!anomaly) {
      throw new NotFoundException(`Anomaly ${anomalyId} not found in run ${payrollRunId}`);
    }

    if (anomaly.resolved) {
      throw new BadRequestException(`Anomaly ${anomalyId} is already resolved`);
    }

    // Store resolution notes in the details JSON field
    const existingDetails = (anomaly.details as Record<string, unknown>) ?? {};
    const updatedDetails = {
      ...existingDetails,
      resolutionNotes,
      resolvedByUserId: userId,
    };

    return this.db.client.payrollAnomaly.update({
      where: { id: anomalyId },
      data: {
        resolved: true,
        resolvedBy: userId,
        resolvedAt: new Date(),
        details: updatedDetails as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ─── List Payroll Runs ─────────────────────────────────────

  async listRuns(tenantId: string, query: { page?: number; limit?: number; status?: string }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { tenantId };
    if (query.status) where.status = query.status;

    const [runs, total] = await Promise.all([
      this.db.client.payrollRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: { select: { anomalies: true, lineItems: true } },
        },
      }),
      this.db.client.payrollRun.count({ where }),
    ]);

    return {
      data: runs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Export Report ─────────────────────────────────────────

  async exportReport(
    payrollRunId: string,
    tenantId: string,
    format: string,
  ): Promise<{ content: string; contentType: string; filename: string }> {
    const report = await this.getReport(payrollRunId, tenantId);

    if (format === 'pdf') {
      return this.exportAsPdf(report);
    }
    return this.exportAsCsv(report);
  }

  private exportAsCsv(
    report: ReconciliationReport,
  ): { content: string; contentType: string; filename: string } {
    const lines: string[] = [];

    // Header
    lines.push('Anomaly ID,Employee ID,Type,Severity,Resolved,Details,Created At');

    // Data rows
    for (const anomaly of report.anomalies as Array<Record<string, unknown>>) {
      const details = anomaly.details as Record<string, unknown>;
      const message = String(details?.message ?? '').replace(/"/g, '""');
      lines.push(
        [
          anomaly.id,
          anomaly.employeeId,
          anomaly.anomalyType,
          anomaly.severity,
          anomaly.resolved ? 'Yes' : 'No',
          `"${message}"`,
          anomaly.createdAt,
        ].join(','),
      );
    }

    return {
      content: lines.join('\n'),
      contentType: 'text/csv',
      filename: `reconciliation-${report.summary.payrollRunId}-${report.summary.period}.csv`,
    };
  }

  private exportAsPdf(
    report: ReconciliationReport,
  ): { content: string; contentType: string; filename: string } {
    // Generate a structured text report (MVP — no heavy PDF lib)
    const s = report.summary;
    const sections: string[] = [];

    sections.push('RECONCILIATION REPORT');
    sections.push('='.repeat(60));
    sections.push(`Payroll Run: ${s.payrollRunId}`);
    sections.push(`Period: ${s.period}`);
    sections.push(`Status: ${s.status}`);
    sections.push(`Generated: ${report.generatedAt.toISOString()}`);
    sections.push('');
    sections.push('SUMMARY');
    sections.push('-'.repeat(40));
    sections.push(`Total Employees: ${s.totalEmployees}`);
    sections.push(`Total Line Items: ${s.totalLineItems}`);
    sections.push(`Total Gross: $${s.totalGross.toLocaleString()}`);
    sections.push(`Total Net: $${s.totalNet.toLocaleString()}`);
    sections.push(`Total Anomalies: ${s.totalAnomalies}`);
    sections.push(`Resolved: ${s.resolvedCount}`);
    sections.push(`Unresolved: ${s.unresolvedCount}`);
    sections.push(`Amount at Risk: $${s.totalAmountAtRisk.toLocaleString()}`);
    sections.push(`Has Blockers: ${s.hasBlockers ? 'YES' : 'NO'}`);
    sections.push('');
    sections.push('ANOMALIES BY SEVERITY');
    sections.push('-'.repeat(40));
    for (const [severity, count] of Object.entries(s.anomaliesBySeverity)) {
      sections.push(`  ${severity}: ${count}`);
    }
    sections.push('');
    sections.push('ANOMALIES BY TYPE');
    sections.push('-'.repeat(40));
    for (const [type, count] of Object.entries(s.anomaliesByType)) {
      sections.push(`  ${type}: ${count}`);
    }
    sections.push('');
    sections.push('ANOMALY DETAILS');
    sections.push('-'.repeat(40));

    for (const anomaly of report.anomalies as Array<Record<string, unknown>>) {
      const details = anomaly.details as Record<string, unknown>;
      sections.push(`[${anomaly.severity}] ${anomaly.anomalyType} — Employee: ${anomaly.employeeId}`);
      sections.push(`  ${details?.message ?? 'No details'}`);
      if (details?.suggestedAction) {
        sections.push(`  Action: ${details.suggestedAction}`);
      }
      if (anomaly.resolved) {
        sections.push(`  ✓ Resolved by ${(details as Record<string, unknown>)?.resolvedByUserId ?? anomaly.resolvedBy}`);
        if (details?.resolutionNotes) {
          sections.push(`  Notes: ${details.resolutionNotes}`);
        }
      }
      sections.push('');
    }

    if (report.traces.length > 0) {
      sections.push('TRACE REPORTS');
      sections.push('='.repeat(60));
      for (const trace of report.traces) {
        sections.push(`Employee: ${trace.employeeName} (${trace.employeeId})`);
        sections.push(`Period: ${trace.period}`);
        sections.push(`Summary: ${trace.summary}`);
        sections.push(`Steps: ${trace.steps.length}`);
        for (const step of trace.steps) {
          sections.push(`  [${step.order}] ${step.type}: ${step.explanation}`);
        }
        sections.push('');
      }
    }

    return {
      content: sections.join('\n'),
      contentType: 'text/plain',
      filename: `reconciliation-${s.payrollRunId}-${s.period}.txt`,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────

  private async findRun(payrollRunId: string, tenantId: string) {
    const run = await this.db.client.payrollRun.findFirst({
      where: { id: payrollRunId, tenantId },
    });
    if (!run) {
      throw new NotFoundException(`Payroll run ${payrollRunId} not found`);
    }
    return run;
  }

  private async computeTotals(payrollRunId: string) {
    const items = await this.db.client.payrollLineItem.findMany({
      where: { payrollRunId },
      select: { component: true, amount: true },
    });

    let gross = 0;
    let deductions = 0;
    const deductionPrefixes = ['TAX', 'DEDUCTION', 'INSURANCE', 'PENSION', 'CONTRIBUTION'];

    for (const item of items) {
      const amount = Number(item.amount);
      const upper = item.component.toUpperCase();
      if (deductionPrefixes.some((p) => upper.startsWith(p))) {
        deductions += Math.abs(amount);
      } else {
        gross += amount;
      }
    }

    return { gross, net: gross - deductions };
  }
}

