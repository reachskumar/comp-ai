import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import {
  buildCopilotGraph,
  streamGraphToSSE,
  type CopilotDbAdapter,
  type CopilotUserContext,
  type CopilotUserRole,
  type SSEEvent,
  type RuleManagementDbAdapter,
} from '@compensation/ai';
import { HumanMessage } from '@langchain/core/messages';
import { Prisma } from '@compensation/database';

@Injectable()
export class CopilotService implements CopilotDbAdapter {
  private readonly logger = new Logger(CopilotService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Rule Management Adapter (for Copilot rule tools) ───────

  get ruleManagement(): RuleManagementDbAdapter {
    const db = this.db;
    return {
      async getRuleSet(tenantId: string, ruleSetId: string) {
        return db.forTenant(tenantId, (tx) =>
          tx.ruleSet.findFirst({
            where: { id: ruleSetId, tenantId },
            include: { rules: { orderBy: { priority: 'asc' } } },
          }),
        );
      },
      async listRuleSets(tenantId: string, filters) {
        const where: Record<string, unknown> = { tenantId };
        if (filters.status) where['status'] = filters.status;
        if (filters.search) where['name'] = { contains: filters.search, mode: 'insensitive' };
        return db.forTenant(tenantId, (tx) =>
          tx.ruleSet.findMany({
            where: where as never,
            take: filters.limit ?? 20,
            orderBy: { updatedAt: 'desc' },
            include: { _count: { select: { rules: true } } },
          }),
        );
      },
      async createRuleSet(tenantId: string, data) {
        return db.forTenant(tenantId, (tx) =>
          tx.ruleSet.create({
            data: {
              tenantId,
              name: data.name,
              description: data.description,
              effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : undefined,
              rules: data.rules?.length
                ? {
                    create: data.rules.map((r) => ({
                      name: r.name,
                      ruleType: r.ruleType as never,
                      priority: r.priority ?? 0,
                      conditions: (r.conditions ?? {}) as never,
                      actions: (r.actions ?? {}) as never,
                      metadata: (r.metadata ?? {}) as never,
                      enabled: r.enabled ?? true,
                    })),
                  }
                : undefined,
            },
            include: { rules: true },
          }),
        );
      },
      async addRule(tenantId: string, ruleSetId: string, data) {
        const rs = await db.forTenant(tenantId, (tx) =>
          tx.ruleSet.findFirst({ where: { id: ruleSetId, tenantId } }),
        );
        if (!rs) throw new NotFoundException(`RuleSet ${ruleSetId} not found`);
        return db.forTenant(tenantId, (tx) =>
          (tx as any).rule.create({
            data: {
              ruleSetId,
              name: data.name,
              ruleType: data.ruleType as never,
              priority: data.priority ?? 0,
              conditions: (data.conditions ?? {}) as never,
              actions: (data.actions ?? {}) as never,
              metadata: (data.metadata ?? {}) as never,
              enabled: data.enabled ?? true,
            },
          }),
        );
      },
      async updateRule(tenantId: string, ruleSetId: string, ruleId: string, data) {
        const rs = await db.forTenant(tenantId, (tx) =>
          tx.ruleSet.findFirst({ where: { id: ruleSetId, tenantId } }),
        );
        if (!rs) throw new NotFoundException(`RuleSet ${ruleSetId} not found`);
        return db.forTenant(tenantId, (tx) =>
          (tx as any).rule.update({ where: { id: ruleId }, data }),
        );
      },
      async deleteRule(tenantId: string, ruleSetId: string, ruleId: string) {
        const rs = await db.forTenant(tenantId, (tx) =>
          tx.ruleSet.findFirst({ where: { id: ruleSetId, tenantId } }),
        );
        if (!rs) throw new NotFoundException(`RuleSet ${ruleSetId} not found`);
        return db.forTenant(tenantId, (tx) => (tx as any).rule.delete({ where: { id: ruleId } }));
      },
      async generateFromSource(tenantId: string, params) {
        const source = await db.forTenant(tenantId, (tx) =>
          tx.ruleSet.findFirst({
            where: { id: params.sourceRuleSetId, tenantId },
            include: { rules: { orderBy: { priority: 'asc' } } },
          }),
        );
        if (!source)
          throw new NotFoundException(`Source rule set ${params.sourceRuleSetId} not found`);
        return {
          source,
          message: 'Use the deterministic generate endpoint for factor-based generation',
        };
      },
    };
  }

  // ─── Graph Invocation ──────────────────────────────────────

  async *streamChat(
    tenantId: string,
    userId: string,
    message: string,
    conversationId?: string,
    userContext?: CopilotUserContext,
  ): AsyncGenerator<SSEEvent> {
    const role = userContext?.role ?? 'EMPLOYEE';
    this.logger.log(
      `Copilot chat: tenant=${tenantId} user=${userId} role=${role} conv=${conversationId ?? 'new'}`,
    );

    const { graph } = await buildCopilotGraph(this, tenantId, userContext, { userId });

    const config = conversationId
      ? { configurable: { thread_id: conversationId } }
      : { configurable: { thread_id: `copilot-${tenantId}-${userId}-${Date.now()}` } };

    const stream = graph.streamEvents(
      {
        tenantId,
        userId,
        messages: [new HumanMessage(message)],
        metadata: {},
        userRole: role,
        userName: userContext?.name ?? '',
      },
      { ...config, version: 'v2' },
    );

    yield* streamGraphToSSE(stream, {
      graphName: 'copilot-graph',
      runId: config.configurable.thread_id,
    });
  }

  // ─── Conversation Persistence (Task 5) ─────────────────────

  async listConversations(tenantId: string, userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    return this.db.forTenant(tenantId, async (tx) => {
      const [data, total] = await Promise.all([
        tx.copilotConversation.findMany({
          where: { tenantId, userId },
          skip,
          take: limit,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            title: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { messages: true } },
          },
        }),
        tx.copilotConversation.count({ where: { tenantId, userId } }),
      ]);
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async getConversation(tenantId: string, userId: string, conversationId: string) {
    return this.db.forTenant(tenantId, (tx) =>
      tx.copilotConversation.findFirst({
        where: { id: conversationId, tenantId, userId },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              role: true,
              content: true,
              metadata: true,
              createdAt: true,
            },
          },
        },
      }),
    );
  }

  async deleteConversation(tenantId: string, userId: string, conversationId: string) {
    return this.db.forTenant(tenantId, async (tx) => {
      const conv = await tx.copilotConversation.findFirst({
        where: { id: conversationId, tenantId, userId },
      });
      if (!conv) return { deleted: false };
      await tx.copilotConversation.delete({ where: { id: conversationId } });
      return { deleted: true };
    });
  }

  async saveMessage(
    tenantId: string,
    userId: string,
    conversationId: string | undefined,
    role: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<{ conversationId: string; messageId: string }> {
    return this.db.forTenant(tenantId, async (tx) => {
      let convId = conversationId;

      if (!convId) {
        // Create a new conversation with title from first message
        const title = content.length > 80 ? content.slice(0, 77) + '...' : content;
        const conv = await tx.copilotConversation.create({
          data: { tenantId, userId, title },
        });
        convId = conv.id;
      } else {
        // Touch updatedAt on existing conversation
        await tx.copilotConversation.updateMany({
          where: { id: convId, tenantId, userId },
          data: { updatedAt: new Date() },
        });
      }

      const msg = await tx.copilotMessage.create({
        data: {
          conversationId: convId,
          role,
          content,
          metadata: metadata as never,
        },
      });

      return { conversationId: convId, messageId: msg.id };
    });
  }

  // ─── CopilotDbAdapter Implementation ──────────────────────

  async queryEmployees(
    tenantId: string,
    filters: {
      department?: string;
      level?: string;
      location?: string;
      minSalary?: number;
      maxSalary?: number;
      search?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
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

    return this.db.forTenant(tenantId, (tx) =>
      tx.employee.findMany({
        where,
        take: filters.limit ?? 50,
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          department: true,
          level: true,
          location: true,
          baseSalary: true,
          totalComp: true,
          currency: true,
          hireDate: true,
        },
      }),
    );
  }

  async queryCompensation(
    tenantId: string,
    filters: {
      employeeId?: string;
      department?: string;
      component?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Prisma.CompRecommendationWhereInput = {
      cycle: { tenantId },
    };
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.department) {
      where.employee = { department: filters.department };
    }

    return this.db.forTenant(tenantId, (tx) =>
      tx.compRecommendation.findMany({
        where,
        take: filters.limit ?? 50,
        include: {
          employee: { select: { firstName: true, lastName: true, department: true } },
          cycle: { select: { name: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async queryRules(
    tenantId: string,
    filters: {
      status?: string;
      ruleType?: string;
      search?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Prisma.RuleSetWhereInput = { tenantId };
    if (filters.status) where.status = filters.status as Prisma.EnumRuleSetStatusFilter;
    if (filters.search) where.name = { contains: filters.search, mode: 'insensitive' };

    return this.db.forTenant(tenantId, (tx) =>
      tx.ruleSet.findMany({
        where,
        take: filters.limit ?? 20,
        include: { rules: { take: 10 } },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }

  async queryCycles(
    tenantId: string,
    filters: {
      status?: string;
      cycleType?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Prisma.CompCycleWhereInput = { tenantId };
    if (filters.status) where.status = filters.status as Prisma.EnumCycleStatusFilter;
    if (filters.cycleType) where.cycleType = filters.cycleType as Prisma.EnumCycleTypeFilter;

    return this.db.forTenant(tenantId, (tx) =>
      tx.compCycle.findMany({
        where,
        take: filters.limit ?? 10,
        include: { budgets: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async queryPayroll(
    tenantId: string,
    filters: {
      status?: string;
      period?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Prisma.PayrollRunWhereInput = { tenantId };
    if (filters.status) where.status = filters.status as Prisma.EnumPayrollStatusFilter;
    if (filters.period) where.period = filters.period;

    return this.db.forTenant(tenantId, (tx) =>
      tx.payrollRun.findMany({
        where,
        take: filters.limit ?? 10,
        include: { _count: { select: { lineItems: true, anomalies: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async queryAnalytics(
    tenantId: string,
    filters: {
      metric: string;
      groupBy?: string;
      department?: string;
    },
  ): Promise<unknown> {
    const baseWhere: Prisma.EmployeeWhereInput = { tenantId };
    if (filters.department) baseWhere.department = filters.department;

    return this.db.forTenant(tenantId, async (tx) => {
      switch (filters.metric) {
        case 'avg_salary': {
          const result = await tx.employee.aggregate({
            where: baseWhere,
            _avg: { baseSalary: true, totalComp: true },
            _count: true,
          });
          if (filters.groupBy === 'department') {
            const grouped = await tx.employee.groupBy({
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
            return tx.employee.groupBy({
              by: ['department'],
              where: { tenantId },
              _count: true,
            });
          }
          if (filters.groupBy === 'level') {
            return tx.employee.groupBy({
              by: ['level'],
              where: { tenantId },
              _count: true,
            });
          }
          return tx.employee.count({ where: baseWhere });
        }
        case 'total_comp': {
          return tx.employee.aggregate({
            where: baseWhere,
            _sum: { baseSalary: true, totalComp: true },
            _count: true,
          });
        }
        case 'salary_range': {
          return tx.employee.aggregate({
            where: baseWhere,
            _min: { baseSalary: true },
            _max: { baseSalary: true },
            _avg: { baseSalary: true },
            _count: true,
          });
        }
        case 'comp_ratio': {
          // Fetch employees with salary data
          const employees = await tx.employee.findMany({
            where: baseWhere,
            select: {
              id: true,
              baseSalary: true,
              department: true,
              level: true,
              location: true,
              jobFamily: true,
              currency: true,
            },
          });

          if (employees.length === 0) {
            return { avgCompaRatio: null, count: 0, byGroup: [] };
          }

          // Fetch all relevant salary bands
          const bands = await tx.salaryBand.findMany({
            where: { tenantId },
            select: {
              jobFamily: true,
              level: true,
              location: true,
              currency: true,
              p50: true,
            },
          });

          // Calculate compa-ratio for each employee
          const employeesWithCompaRatio = employees
            .map((emp) => {
              // Find matching salary band
              const band = bands.find(
                (b) =>
                  (b.jobFamily === emp.jobFamily || !b.jobFamily) &&
                  (b.level === emp.level || !b.level) &&
                  (b.location === emp.location || !b.location) &&
                  b.currency === emp.currency,
              );

              if (!band || !band.p50 || Number(band.p50) === 0) {
                return null; // Skip employees without matching bands
              }

              const compaRatio = Number(emp.baseSalary) / Number(band.p50);
              return {
                ...emp,
                compaRatio,
                bandP50: Number(band.p50),
              };
            })
            .filter((e) => e !== null);

          if (employeesWithCompaRatio.length === 0) {
            return {
              avgCompaRatio: null,
              count: 0,
              message: 'No employees matched to salary bands',
            };
          }

          // Calculate overall average
          const totalCompaRatio = employeesWithCompaRatio.reduce((sum, e) => sum + e.compaRatio, 0);
          const avgCompaRatio = totalCompaRatio / employeesWithCompaRatio.length;

          // Group by if requested
          if (filters.groupBy) {
            const groupField = filters.groupBy as 'department' | 'level' | 'location';
            if (['department', 'level', 'location'].includes(groupField)) {
              const grouped = new Map<string, { sum: number; count: number }>();

              for (const emp of employeesWithCompaRatio) {
                const key = emp[groupField] || 'Unknown';
                const existing = grouped.get(key) || { sum: 0, count: 0 };
                grouped.set(key, {
                  sum: existing.sum + emp.compaRatio,
                  count: existing.count + 1,
                });
              }

              const byGroup = Array.from(grouped.entries()).map(([key, value]) => ({
                [groupField]: key,
                avgCompaRatio: Math.round((value.sum / value.count) * 10000) / 10000,
                count: value.count,
              }));

              return {
                overall: {
                  avgCompaRatio: Math.round(avgCompaRatio * 10000) / 10000,
                  count: employeesWithCompaRatio.length,
                },
                byGroup,
              };
            }
          }

          return {
            avgCompaRatio: Math.round(avgCompaRatio * 10000) / 10000,
            count: employeesWithCompaRatio.length,
            totalEmployees: employees.length,
            matchedToBands: employeesWithCompaRatio.length,
          };
        }
        default:
          return { error: `Unknown metric: ${filters.metric}` };
      }
    });
  }

  // ─── New Read Tools (Task 3) ─────────────────────────────

  async queryBenefits(
    tenantId: string,
    filters: {
      employeeId?: string;
      planType?: string;
      status?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Prisma.BenefitEnrollmentWhereInput = { tenantId };
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.status) where.status = filters.status as Prisma.EnumEnrollmentStatusFilter;
    if (filters.planType)
      where.plan = { planType: filters.planType as Prisma.EnumBenefitPlanTypeFilter };

    return this.db.forTenant(tenantId, (tx) =>
      tx.benefitEnrollment.findMany({
        where,
        take: filters.limit ?? 20,
        include: {
          plan: { select: { name: true, planType: true, carrier: true } },
          employee: { select: { firstName: true, lastName: true, department: true } },
        },
        orderBy: { effectiveDate: 'desc' },
      }),
    );
  }

  async queryEquity(
    tenantId: string,
    filters: {
      employeeId?: string;
      status?: string;
      grantType?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Prisma.EquityGrantWhereInput = { tenantId };
    if (filters.employeeId) where.employeeId = filters.employeeId;
    if (filters.status) where.status = filters.status as Prisma.EnumEquityGrantStatusFilter;
    if (filters.grantType) where.grantType = filters.grantType as Prisma.EnumEquityGrantTypeFilter;

    return this.db.forTenant(tenantId, (tx) =>
      tx.equityGrant.findMany({
        where,
        take: filters.limit ?? 20,
        include: {
          plan: { select: { name: true, planType: true, sharePrice: true, currency: true } },
          employee: { select: { firstName: true, lastName: true, department: true } },
        },
        orderBy: { grantDate: 'desc' },
      }),
    );
  }

  async querySalaryBands(
    tenantId: string,
    filters: {
      jobFamily?: string;
      level?: string;
      location?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Prisma.SalaryBandWhereInput = { tenantId };
    if (filters.jobFamily) where.jobFamily = { contains: filters.jobFamily, mode: 'insensitive' };
    if (filters.level) where.level = filters.level;
    if (filters.location) where.location = { contains: filters.location, mode: 'insensitive' };

    return this.db.forTenant(tenantId, (tx) =>
      tx.salaryBand.findMany({
        where,
        take: filters.limit ?? 20,
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
          source: true,
          effectiveDate: true,
        },
        orderBy: [{ jobFamily: 'asc' }, { level: 'asc' }],
      }),
    );
  }

  async queryNotifications(
    tenantId: string,
    filters: {
      userId: string;
      unreadOnly?: boolean;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Prisma.NotificationWhereInput = { tenantId, userId: filters.userId };
    if (filters.unreadOnly) where.read = false;

    return this.db.forTenant(tenantId, (tx) =>
      tx.notification.findMany({
        where,
        take: filters.limit ?? 10,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          read: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async queryTeam(
    tenantId: string,
    filters: {
      managerId: string;
      includeIndirect?: boolean;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Prisma.EmployeeWhereInput = { tenantId, managerId: filters.managerId };

    return this.db.forTenant(tenantId, async (tx) => {
      const directReports = await tx.employee.findMany({
        where,
        take: filters.limit ?? 50,
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          department: true,
          level: true,
          location: true,
          baseSalary: true,
          totalComp: true,
          currency: true,
          hireDate: true,
          performanceRating: true,
          _count: { select: { directReports: true } },
        },
        orderBy: [{ department: 'asc' }, { lastName: 'asc' }],
      });

      if (!filters.includeIndirect) return directReports;

      // Include indirect reports (one level deeper)
      const directIds = directReports.map((r) => r.id);
      const indirectReports = await tx.employee.findMany({
        where: { tenantId, managerId: { in: directIds } },
        take: filters.limit ?? 50,
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          department: true,
          level: true,
          location: true,
          baseSalary: true,
          totalComp: true,
          currency: true,
          hireDate: true,
          performanceRating: true,
          managerId: true,
        },
        orderBy: [{ department: 'asc' }, { lastName: 'asc' }],
      });

      // Return all reports as a flat array with a type marker
      return [
        ...directReports.map((r) => ({ ...r, reportType: 'direct' as const })),
        ...indirectReports.map((r) => ({ ...r, reportType: 'indirect' as const })),
      ];
    });
  }

  // ─── Action Tools (Task 4) ───────────────────────────────

  async approveRecommendation(
    tenantId: string,
    userId: string,
    params: { recommendationId: string; comment?: string },
  ): Promise<unknown> {
    return this.db.forTenant(tenantId, async (tx) => {
      const rec = await tx.compRecommendation.findFirst({
        where: { id: params.recommendationId, cycle: { tenantId } },
        include: {
          employee: { select: { firstName: true, lastName: true } },
          cycle: { select: { name: true } },
        },
      });
      if (!rec) return { error: `Recommendation ${params.recommendationId} not found` };
      if (rec.status !== 'SUBMITTED' && rec.status !== 'DRAFT') {
        return { error: `Recommendation is in ${rec.status} status and cannot be approved` };
      }

      const updated = await tx.compRecommendation.update({
        where: { id: params.recommendationId },
        data: {
          status: 'APPROVED',
          approverUserId: userId,
          approvedAt: new Date(),
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'COPILOT_APPROVE_RECOMMENDATION',
          entityType: 'CompRecommendation',
          entityId: params.recommendationId,
          changes: {
            previousStatus: rec.status,
            newStatus: 'APPROVED',
            comment: params.comment ?? null,
            source: 'ai_copilot',
          } as never,
        },
      });

      return {
        success: true,
        message: `Approved ${rec.recType} recommendation for ${rec.employee.firstName} ${rec.employee.lastName}`,
        recommendation: {
          id: updated.id,
          employee: `${rec.employee.firstName} ${rec.employee.lastName}`,
          cycle: rec.cycle.name,
          type: rec.recType,
          currentValue: Number(rec.currentValue),
          proposedValue: Number(rec.proposedValue),
          status: 'APPROVED',
        },
      };
    });
  }

  async rejectRecommendation(
    tenantId: string,
    userId: string,
    params: { recommendationId: string; reason: string },
  ): Promise<unknown> {
    return this.db.forTenant(tenantId, async (tx) => {
      const rec = await tx.compRecommendation.findFirst({
        where: { id: params.recommendationId, cycle: { tenantId } },
        include: {
          employee: { select: { firstName: true, lastName: true } },
          cycle: { select: { name: true } },
        },
      });
      if (!rec) return { error: `Recommendation ${params.recommendationId} not found` };
      if (rec.status !== 'SUBMITTED' && rec.status !== 'DRAFT') {
        return { error: `Recommendation is in ${rec.status} status and cannot be rejected` };
      }

      const updated = await tx.compRecommendation.update({
        where: { id: params.recommendationId },
        data: {
          status: 'REJECTED',
          justification: params.reason,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'COPILOT_REJECT_RECOMMENDATION',
          entityType: 'CompRecommendation',
          entityId: params.recommendationId,
          changes: {
            previousStatus: rec.status,
            newStatus: 'REJECTED',
            reason: params.reason,
            source: 'ai_copilot',
          } as never,
        },
      });

      return {
        success: true,
        message: `Rejected ${rec.recType} recommendation for ${rec.employee.firstName} ${rec.employee.lastName}. Reason: ${params.reason}`,
        recommendation: {
          id: updated.id,
          employee: `${rec.employee.firstName} ${rec.employee.lastName}`,
          cycle: rec.cycle.name,
          type: rec.recType,
          status: 'REJECTED',
          reason: params.reason,
        },
      };
    });
  }

  async requestLetter(
    tenantId: string,
    userId: string,
    params: {
      employeeId: string;
      letterType: string;
      salaryIncreasePercent?: number;
      bonusAmount?: number;
      effectiveDate?: string;
    },
  ): Promise<unknown> {
    return this.db.forTenant(tenantId, async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: params.employeeId, tenantId },
        select: { id: true, firstName: true, lastName: true, department: true, level: true },
      });
      if (!employee) return { error: `Employee ${params.employeeId} not found` };

      // Create the letter record in GENERATING status
      const letter = await tx.compensationLetter.create({
        data: {
          tenantId,
          userId,
          employeeId: params.employeeId,
          letterType: params.letterType as never,
          status: 'GENERATING' as never,
          subject: `${params.letterType} letter - ${employee.firstName} ${employee.lastName}`,
          content: '',
          compData: {
            salaryIncreasePercent: params.salaryIncreasePercent,
            bonusAmount: params.bonusAmount,
            effectiveDate: params.effectiveDate,
          } as never,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'COPILOT_REQUEST_LETTER',
          entityType: 'CompensationLetter',
          entityId: letter.id,
          changes: {
            letterType: params.letterType,
            employeeId: params.employeeId,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            source: 'ai_copilot',
          } as never,
        },
      });

      return {
        success: true,
        message: `${params.letterType} letter generation initiated for ${employee.firstName} ${employee.lastName}`,
        letter: {
          id: letter.id,
          employee: `${employee.firstName} ${employee.lastName}`,
          department: employee.department,
          type: params.letterType,
          status: 'GENERATING',
        },
      };
    });
  }
}
