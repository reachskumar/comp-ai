import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import {
  buildReportBuilderGraph,
  streamGraphToSSE,
  type ReportBuilderDbAdapter,
  type SSEEvent,
} from '@compensation/ai';
import { HumanMessage } from '@langchain/core/messages';
import { Prisma } from '@compensation/database';

/** Allowed models for report queries — whitelist for security */
const ALLOWED_MODELS = [
  'Employee', 'CompRecommendation', 'CompCycle',
  'PayrollRun', 'RuleSet', 'BenefitPlan', 'BenefitEnrollment',
] as const;

type AllowedModel = typeof ALLOWED_MODELS[number];

@Injectable()
export class ReportsService implements ReportBuilderDbAdapter {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Graph Invocation ──────────────────────────────────────

  async *streamGenerate(
    tenantId: string,
    userId: string,
    prompt: string,
    conversationId?: string,
  ): AsyncGenerator<SSEEvent> {
    this.logger.log(`Report generate: tenant=${tenantId} user=${userId}`);

    const { graph } = await buildReportBuilderGraph(this, tenantId);

    const threadId = conversationId
      ?? `report-${tenantId}-${userId}-${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };

    const stream = graph.streamEvents(
      {
        tenantId,
        userId,
        messages: [new HumanMessage(prompt)],
        metadata: {},
      },
      { ...config, version: 'v2' },
    );

    yield* streamGraphToSSE(stream, {
      graphName: 'report-builder-graph',
      runId: threadId,
    });
  }

  // ─── Saved Reports CRUD ────────────────────────────────────

  async saveReport(tenantId: string, userId: string, data: {
    title: string; prompt: string; queryType?: string;
    filters?: Record<string, unknown>; results?: unknown;
    chartConfig?: Record<string, unknown>; narrative?: string;
  }) {
    return this.db.client.savedReport.create({
      data: {
        tenantId, userId,
        title: data.title,
        prompt: data.prompt,
        status: 'COMPLETED',
        queryType: data.queryType,
        filters: data.filters ?? {},
        results: data.results ?? [],
        chartConfig: data.chartConfig ?? {},
        narrative: data.narrative,
      },
    });
  }

  async listReports(tenantId: string, userId: string) {
    return this.db.client.savedReport.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getReport(tenantId: string, id: string) {
    const report = await this.db.client.savedReport.findFirst({
      where: { id, tenantId },
    });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  // ─── Export ────────────────────────────────────────────────

  async exportReport(tenantId: string, id: string, format: string) {
    const report = await this.getReport(tenantId, id);
    const results = report.results as unknown[];

    if (format === 'csv') {
      return this.toCsv(results);
    }
    // PDF and Excel would require additional libraries
    // For now, return JSON for other formats
    return JSON.stringify(results, null, 2);
  }

  private toCsv(data: unknown[]): string {
    if (!Array.isArray(data) || data.length === 0) return '';
    const rows = data as Record<string, unknown>[];
    const headers = Object.keys(rows[0] ?? {});
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map(h => {
        const val = row[h];
        const str = val == null ? '' : String(val);
        return str.includes(',') ? `"${str}"` : str;
      }).join(','));
    }
    return lines.join('\n');
  }

  // ─── ReportBuilderDbAdapter Implementation ─────────────────

  async executeReportQuery(tenantId: string, params: {
    model: string; groupBy?: string; aggregation?: string;
    filters?: Record<string, unknown>; orderBy?: string;
    orderDir?: string; limit?: number;
  }): Promise<unknown> {
    const model = params.model as AllowedModel;
    if (!ALLOWED_MODELS.includes(model)) {
      return { error: `Model "${params.model}" is not allowed` };
    }
    return this.executeModelQuery(tenantId, model, params);
  }

  async aggregateReportData(tenantId: string, params: {
    model: string; metric: string; groupBy?: string;
    filters?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.executeAggregation(tenantId, params);
  }

  async getSchemaInfo() {
    return { models: SCHEMA_INFO };
  }

  // ─── Private Query Helpers ─────────────────────────────────

  private async executeModelQuery(
    tenantId: string, model: AllowedModel, params: {
      groupBy?: string; aggregation?: string;
      filters?: Record<string, unknown>; orderBy?: string;
      orderDir?: string; limit?: number;
    },
  ): Promise<unknown> {
    // All queries are tenant-scoped and read-only via Prisma
    switch (model) {
      case 'Employee':
        return this.queryEmployees(tenantId, params);
      case 'CompRecommendation':
        return this.queryCompRecommendations(tenantId, params);
      case 'CompCycle':
        return this.queryCompCycles(tenantId, params);
      case 'PayrollRun':
        return this.db.client.payrollRun.findMany({
          where: { tenantId },
          take: params.limit ?? 100,
          orderBy: { createdAt: params.orderDir === 'asc' ? 'asc' : 'desc' },
        });
      case 'RuleSet':
        return this.db.client.ruleSet.findMany({
          where: { tenantId },
          take: params.limit ?? 100,
          orderBy: { updatedAt: 'desc' },
        });
      case 'BenefitPlan':
        return this.db.client.benefitPlan.findMany({
          where: { tenantId },
          take: params.limit ?? 100,
        });
      case 'BenefitEnrollment':
        return this.db.client.benefitEnrollment.findMany({
          where: { tenantId },
          take: params.limit ?? 100,
          include: { employee: { select: { firstName: true, lastName: true, department: true } } },
        });
      default:
        return { error: `Model "${model}" query not implemented` };
    }
  }


  private async queryEmployees(tenantId: string, params: {
    groupBy?: string; aggregation?: string;
    filters?: Record<string, unknown>; limit?: number;
    orderBy?: string; orderDir?: string;
  }): Promise<unknown> {
    const where: Prisma.EmployeeWhereInput = { tenantId };
    if (params.filters?.['department']) where.department = String(params.filters['department']);
    if (params.filters?.['level']) where.level = String(params.filters['level']);
    if (params.filters?.['location']) where.location = String(params.filters['location']);

    if (params.groupBy && params.aggregation) {
      const groupByField = params.groupBy as 'department' | 'level' | 'location';
      if (['department', 'level'].includes(groupByField)) {
        return this.db.client.employee.groupBy({
          by: [groupByField],
          where,
          _avg: { baseSalary: true, totalComp: true },
          _sum: { baseSalary: true, totalComp: true },
          _count: true,
          _min: { baseSalary: true },
          _max: { baseSalary: true },
        });
      }
    }

    return this.db.client.employee.findMany({
      where,
      take: params.limit ?? 100,
      select: {
        id: true, employeeCode: true, firstName: true, lastName: true,
        department: true, level: true, location: true,
        baseSalary: true, totalComp: true, currency: true, hireDate: true,
      },
      orderBy: params.orderBy === 'baseSalary'
        ? { baseSalary: params.orderDir === 'asc' ? 'asc' : 'desc' }
        : { createdAt: 'desc' },
    });
  }

  private async queryCompRecommendations(tenantId: string, params: {
    filters?: Record<string, unknown>; limit?: number;
  }): Promise<unknown> {
    return this.db.client.compRecommendation.findMany({
      where: { cycle: { tenantId } },
      take: params.limit ?? 100,
      include: {
        employee: { select: { firstName: true, lastName: true, department: true } },
        cycle: { select: { name: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async queryCompCycles(tenantId: string, params: {
    filters?: Record<string, unknown>; limit?: number;
  }): Promise<unknown> {
    return this.db.client.compCycle.findMany({
      where: { tenantId },
      take: params.limit ?? 100,
      include: { budgets: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async queryGenericModel(
    _tenantId: string, model: string, _params: Record<string, unknown>,
  ): Promise<unknown> {
    return { error: `Model "${model}" query not implemented` };
  }

  private async executeAggregation(tenantId: string, params: {
    model: string; metric: string; groupBy?: string;
    filters?: Record<string, unknown>;
  }): Promise<unknown> {
    const where: Prisma.EmployeeWhereInput = { tenantId };
    if (params.filters?.['department']) where.department = String(params.filters['department']);

    switch (params.metric) {
      case 'avg_salary': {
        if (params.groupBy === 'department') {
          return this.db.client.employee.groupBy({
            by: ['department'],
            where,
            _avg: { baseSalary: true, totalComp: true },
            _count: true,
          });
        }
        if (params.groupBy === 'level') {
          return this.db.client.employee.groupBy({
            by: ['level'],
            where,
            _avg: { baseSalary: true, totalComp: true },
            _count: true,
          });
        }
        return this.db.client.employee.aggregate({
          where,
          _avg: { baseSalary: true, totalComp: true },
          _count: true,
        });
      }
      case 'headcount': {
        if (params.groupBy) {
          const groupField = params.groupBy as 'department' | 'level';
          if (['department', 'level'].includes(groupField)) {
            return this.db.client.employee.groupBy({
              by: [groupField],
              where,
              _count: true,
            });
          }
        }
        return this.db.client.employee.count({ where });
      }
      case 'total_comp': {
        return this.db.client.employee.aggregate({
          where,
          _sum: { baseSalary: true, totalComp: true },
          _count: true,
        });
      }
      case 'salary_range': {
        return this.db.client.employee.aggregate({
          where,
          _min: { baseSalary: true },
          _max: { baseSalary: true },
          _avg: { baseSalary: true },
          _count: true,
        });
      }
      default:
        return { error: `Unknown metric: ${params.metric}` };
    }
  }
}

const SCHEMA_INFO = [
  {
    name: 'Employee',
    description: 'Employee master data with compensation info',
    fields: [
      { name: 'department', type: 'string', description: 'Department name' },
      { name: 'level', type: 'string', description: 'Job level/grade' },
      { name: 'location', type: 'string', description: 'Office location' },
      { name: 'baseSalary', type: 'decimal', description: 'Base salary amount' },
      { name: 'totalComp', type: 'decimal', description: 'Total compensation' },
      { name: 'hireDate', type: 'datetime', description: 'Date of hire' },
      { name: 'currency', type: 'string', description: 'Currency code' },
    ],
  },
  {
    name: 'CompRecommendation',
    description: 'Compensation recommendations from cycles',
    fields: [
      { name: 'component', type: 'string', description: 'Comp component (MERIT, BONUS, LTI)' },
      { name: 'currentAmount', type: 'decimal', description: 'Current amount' },
      { name: 'recommendedAmount', type: 'decimal', description: 'Recommended amount' },
      { name: 'status', type: 'string', description: 'Recommendation status' },
    ],
  },
  {
    name: 'CompCycle',
    description: 'Compensation cycles',
    fields: [
      { name: 'name', type: 'string', description: 'Cycle name' },
      { name: 'status', type: 'string', description: 'Cycle status' },
      { name: 'cycleType', type: 'string', description: 'Type (MERIT, BONUS, LTI, COMBINED)' },
      { name: 'totalBudget', type: 'decimal', description: 'Total budget' },
    ],
  },
  {
    name: 'PayrollRun',
    description: 'Payroll processing runs',
    fields: [
      { name: 'period', type: 'string', description: 'Payroll period' },
      { name: 'status', type: 'string', description: 'Run status' },
      { name: 'totalGross', type: 'decimal', description: 'Total gross pay' },
      { name: 'totalNet', type: 'decimal', description: 'Total net pay' },
    ],
  },
  {
    name: 'BenefitPlan',
    description: 'Benefit plans offered',
    fields: [
      { name: 'name', type: 'string', description: 'Plan name' },
      { name: 'planType', type: 'string', description: 'Plan type' },
      { name: 'status', type: 'string', description: 'Plan status' },
    ],
  },
];
