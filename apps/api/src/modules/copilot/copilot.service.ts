import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database';
import {
  buildCopilotGraph,
  streamGraphToSSE,
  type CopilotDbAdapter,
  type SSEEvent,
} from '@compensation/ai';
import { HumanMessage } from '@langchain/core/messages';
import { Prisma } from '@compensation/database';

@Injectable()
export class CopilotService implements CopilotDbAdapter {
  private readonly logger = new Logger(CopilotService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Graph Invocation ──────────────────────────────────────

  async *streamChat(
    tenantId: string,
    userId: string,
    message: string,
    conversationId?: string,
  ): AsyncGenerator<SSEEvent> {
    this.logger.log(
      `Copilot chat: tenant=${tenantId} user=${userId} conv=${conversationId ?? 'new'}`,
    );

    const { graph } = await buildCopilotGraph(this, tenantId);

    const config = conversationId
      ? { configurable: { thread_id: conversationId } }
      : { configurable: { thread_id: `copilot-${tenantId}-${userId}-${Date.now()}` } };

    const stream = graph.streamEvents(
      {
        tenantId,
        userId,
        messages: [new HumanMessage(message)],
        metadata: {},
      },
      { ...config, version: 'v2' },
    );

    yield* streamGraphToSSE(stream, {
      graphName: 'copilot-graph',
      runId: config.configurable.thread_id,
    });
  }

  // ─── CopilotDbAdapter Implementation ──────────────────────

  async queryEmployees(tenantId: string, filters: {
    department?: string; level?: string; location?: string;
    minSalary?: number; maxSalary?: number; search?: string; limit?: number;
  }): Promise<unknown[]> {
    const where: Prisma.EmployeeWhereInput = { tenantId };
    if (filters.department) where.department = filters.department;
    if (filters.level) where.level = filters.level;
    if (filters.location) where.location = filters.location;
    if (filters.minSalary || filters.maxSalary) {
      where.baseSalary = {};
      if (filters.minSalary) where.baseSalary.gte = filters.minSalary;
      if (filters.maxSalary) where.baseSalary.lte = filters.maxSalary;
    }
    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { employeeCode: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.db.client.employee.findMany({
      where,
      take: filters.limit ?? 50,
      select: {
        id: true, employeeCode: true, firstName: true, lastName: true,
        department: true, level: true, location: true,
        baseSalary: true, totalComp: true, currency: true, hireDate: true,
      },
    });
  }

  async queryCompensation(tenantId: string, filters: {
    employeeId?: string; department?: string; component?: string; limit?: number;
  }): Promise<unknown[]> {
    const where: Prisma.CompRecommendationWhereInput = {
      cycle: { tenantId },
    };
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.department) {
      where.employee = { department: filters.department };
    }

    return this.db.client.compRecommendation.findMany({
      where,
      take: filters.limit ?? 50,
      include: {
        employee: { select: { firstName: true, lastName: true, department: true } },
        cycle: { select: { name: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async queryRules(tenantId: string, filters: {
    status?: string; ruleType?: string; search?: string; limit?: number;
  }): Promise<unknown[]> {
    const where: Prisma.RuleSetWhereInput = { tenantId };
    if (filters.status) where.status = filters.status as Prisma.EnumRuleSetStatusFilter;
    if (filters.search) where.name = { contains: filters.search, mode: 'insensitive' };

    return this.db.client.ruleSet.findMany({
      where,
      take: filters.limit ?? 20,
      include: { rules: { take: 10 } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async queryCycles(tenantId: string, filters: {
    status?: string; cycleType?: string; limit?: number;
  }): Promise<unknown[]> {
    const where: Prisma.CompCycleWhereInput = { tenantId };
    if (filters.status) where.status = filters.status as Prisma.EnumCycleStatusFilter;
    if (filters.cycleType) where.cycleType = filters.cycleType as Prisma.EnumCycleTypeFilter;

    return this.db.client.compCycle.findMany({
      where,
      take: filters.limit ?? 10,
      include: { budgets: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async queryPayroll(tenantId: string, filters: {
    status?: string; period?: string; limit?: number;
  }): Promise<unknown[]> {
    const where: Prisma.PayrollRunWhereInput = { tenantId };
    if (filters.status) where.status = filters.status as Prisma.EnumPayrollStatusFilter;
    if (filters.period) where.period = filters.period;

    return this.db.client.payrollRun.findMany({
      where,
      take: filters.limit ?? 10,
      include: { _count: { select: { lineItems: true, anomalies: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async queryAnalytics(tenantId: string, filters: {
    metric: string; groupBy?: string; department?: string;
  }): Promise<unknown> {
    const baseWhere: Prisma.EmployeeWhereInput = { tenantId };
    if (filters.department) baseWhere.department = filters.department;

    switch (filters.metric) {
      case 'avg_salary': {
        const result = await this.db.client.employee.aggregate({
          where: baseWhere,
          _avg: { baseSalary: true, totalComp: true },
          _count: true,
        });
        if (filters.groupBy === 'department') {
          const grouped = await this.db.client.employee.groupBy({
            by: ['department'],
            where: { tenantId },
            _avg: { baseSalary: true, totalComp: true },
            _count: true,
          });
          return { overall: result, byGroup: grouped };
        }
        return result;
      }
      case 'headcount': {
        if (filters.groupBy === 'department') {
          return this.db.client.employee.groupBy({
            by: ['department'],
            where: { tenantId },
            _count: true,
          });
        }
        if (filters.groupBy === 'level') {
          return this.db.client.employee.groupBy({
            by: ['level'],
            where: { tenantId },
            _count: true,
          });
        }
        return this.db.client.employee.count({ where: baseWhere });
      }
      case 'total_comp': {
        return this.db.client.employee.aggregate({
          where: baseWhere,
          _sum: { baseSalary: true, totalComp: true },
          _count: true,
        });
      }
      case 'salary_range': {
        return this.db.client.employee.aggregate({
          where: baseWhere,
          _min: { baseSalary: true },
          _max: { baseSalary: true },
          _avg: { baseSalary: true },
          _count: true,
        });
      }
      default:
        return { error: `Unknown metric: ${filters.metric}` };
    }
  }
}
