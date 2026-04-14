import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import {
  buildCopilotGraph,
  streamGraphToSSE,
  type CopilotDbAdapter,
  type CopilotUserContext,
  type SSEEvent,
  type RuleManagementDbAdapter,
  type MirrorDbAdapter,
} from '@compensation/ai';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { Prisma } from '@compensation/database';
import { DataScopeService, type DataScope } from '../../common';
import { CompportQueryCacheService } from '../compport-bridge/services/compport-query-cache.service';
import { CompportCloudSqlService } from '../compport-bridge/services/compport-cloudsql.service';
import { CompportDataService } from '../compport-bridge/services/compport-data.service';

@Injectable()
export class CopilotService implements CopilotDbAdapter {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly dataScopeService: DataScopeService,
    private readonly queryCache: CompportQueryCacheService,
    private readonly cloudSql: CompportCloudSqlService,
    private readonly compportData: CompportDataService,
  ) {}

  // ─── Mirror Adapter (universal Compport data access) ────────
  //
  // Event-driven + cached architecture. Agent tools hit Redis cache
  // first (<5ms), fallback to Compport MySQL on cache miss (~100ms).
  // No mirror PG schema, no 5.4M-row copy, no type-mapping bugs.

  get mirrorAdapter(): MirrorDbAdapter {
    const cache = this.queryCache;
    const cloudSql = this.cloudSql;
    const db = this.db;
    return {
      async listMirrorTables(tenantId) {
        return cache.listTables(tenantId);
      },

      async describeMirrorTable(tenantId, tableName) {
        return cache.describeTable(tenantId, tableName);
      },

      async queryMirrorTable(tenantId, tableName, filters) {
        // Get the tenant's Compport schema name from the Tenant record
        const tenant = await db.client.tenant.findUnique({
          where: { id: tenantId },
          select: { compportSchema: true },
        });
        if (!tenant?.compportSchema) {
          return [{ error: 'Tenant has no Compport schema configured' }];
        }

        // Ensure Cloud SQL is connected for this query
        if (!cloudSql.isConnected) {
          // Try to find connector and connect
          try {
            const connector = await db.forTenant(tenantId, (tx) =>
              tx.integrationConnector.findFirst({
                where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL', status: 'ACTIVE' },
                select: { id: true, config: true },
              }),
            );
            if (connector) {
              const cfg = (connector.config as Record<string, string>) ?? {};
              await cloudSql.connect({
                host: process.env['DB_HOST'] ?? '',
                port: parseInt(process.env['DB_PORT'] ?? '3306', 10),
                user: process.env['DB_USER'] ?? '',
                password: process.env['DB_PWD'] ?? '',
                database: cfg['schemaName'] ?? tenant.compportSchema,
                sslCa: process.env['MYSQL_CA_CERT'],
                sslCert: process.env['MYSQL_CLIENT_CERT'],
                sslKey: process.env['MYSQL_CLIENT_KEY'],
              });
            }
          } catch (err) {
            return [
              {
                error: `Cannot connect to Compport Cloud SQL: ${(err as Error).message?.substring(0, 150)}`,
              },
            ];
          }
        }

        return cache.queryTable(tenantId, tenant.compportSchema, tableName, cloudSql, filters);
      },
    };
  }

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

    // ── Step 1: Save user message & resolve conversation ID ──
    const { conversationId: dbConvId } = await this.saveMessage(
      tenantId,
      userId,
      conversationId,
      'user',
      message,
    );

    // Emit the DB conversation ID so the frontend can track it
    yield {
      event: 'conversation:id' as SSEEvent['event'],
      data: { conversationId: dbConvId, timestamp: Date.now() },
    };

    // ── Step 2: Load prior messages for conversation context ──
    const historyMessages: BaseMessage[] = [];
    if (conversationId) {
      const conv = await this.getConversation(tenantId, userId, conversationId);
      if (conv?.messages) {
        // Exclude the user message we just saved (last message) to avoid duplication
        const priorMessages = conv.messages.slice(0, -1);
        for (const m of priorMessages) {
          if (m.role === 'user') {
            historyMessages.push(new HumanMessage(m.content));
          } else if (m.role === 'assistant') {
            historyMessages.push(new AIMessage(m.content));
          }
        }
      }
    }

    // ── Step 3: Resolve data scope & build graph with scoped adapter ──
    const scope = await this.dataScopeService.resolveScope(tenantId, userId, role);
    const scopedDb = this.buildScopedAdapter(scope);
    const { graph } = await buildCopilotGraph(scopedDb, tenantId, userContext, { userId });

    const threadId = dbConvId; // Use DB conversation ID as LangGraph thread_id
    const config = { configurable: { thread_id: threadId } };

    const stream = graph.streamEvents(
      {
        tenantId,
        userId,
        messages: [...historyMessages, new HumanMessage(message)],
        metadata: {},
        userRole: role,
        userName: userContext?.name ?? '',
      },
      { ...config, version: 'v2' },
    );

    // ── Step 4: Stream SSE events and collect assistant response ──
    let assistantContent = '';

    for await (const sseEvent of streamGraphToSSE(stream, {
      graphName: 'copilot-graph',
      runId: threadId,
    })) {
      // Collect assistant text chunks for persistence
      if (sseEvent.event === 'message:chunk' && sseEvent.data.content) {
        assistantContent += sseEvent.data.content as string;
      }
      yield sseEvent;
    }

    // ── Step 5: Save assistant response to DB ──
    if (assistantContent) {
      try {
        await this.saveMessage(tenantId, userId, dbConvId, 'assistant', assistantContent);
      } catch (err) {
        this.logger.error('Failed to save assistant message', err);
      }
    }
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
      managerId?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Prisma.EmployeeWhereInput = { tenantId };
    if (filters.department) where.department = filters.department;
    if (filters.level) where.level = filters.level;
    if (filters.location) where.location = filters.location;
    if (filters.managerId) where.managerId = filters.managerId;
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
          managerId: true,
          gender: true,
          jobFamily: true,
          performanceRating: true,
          compaRatio: true,
          terminationDate: true,
          isPeopleManager: true,
          metadata: true,
          manager: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
            },
          },
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
    // Read directly from Compport MySQL — salary + bonus details
    const limit = filters.limit ?? 50;
    const component = filters.component?.toLowerCase();

    if (component === 'bonus') {
      return this.compportData.getEmployeeBonusDetails(tenantId, undefined, limit);
    }
    if (component === 'lti') {
      return this.compportData.getEmployeeLtiDetails(tenantId, undefined, limit);
    }
    // Default: salary details
    return this.compportData.getEmployeeSalaryDetails(tenantId, undefined, limit);
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
    // Read directly from Compport MySQL — hr_parameter + hr_parameter_bonus
    const limit = filters.limit ?? 50;
    const ruleType = filters.ruleType?.toLowerCase();

    if (ruleType === 'bonus') {
      return this.compportData.getBonusRules(tenantId, limit);
    }
    if (ruleType === 'lti') {
      return this.compportData.getLtiRules(tenantId, limit);
    }
    // Default: salary rules (hr_parameter)
    return this.compportData.getSalaryRules(tenantId, limit);
  }

  async queryCycles(
    tenantId: string,
    filters: {
      status?: string;
      cycleType?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
    // Read directly from Compport MySQL — performance_cycle table
    return this.compportData.getCompCycles(tenantId, filters.limit ?? 20);
  }

  async queryPayroll(
    tenantId: string,
    filters: {
      status?: string;
      period?: string;
      limit?: number;
    },
  ): Promise<unknown[]> {
    // Read directly from Compport MySQL — employee_salary_details
    return this.compportData.getEmployeeSalaryDetails(tenantId, undefined, filters.limit ?? 50);
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

          // Fetch pay ranges from Compport MySQL first, fall back to PG salary bands
          let bands: Array<{
            jobFamily: string | null;
            level: string | null;
            location: string | null;
            currency: string;
            p50: unknown;
          }> = [];
          try {
            const compportBands = await this.compportData.getPayRanges(tenantId, 200);
            if (compportBands.length > 0) {
              bands = compportBands.map((row: Record<string, unknown>) => ({
                jobFamily: (row['job_family'] ?? row['function'] ?? row['grade'] ?? null) as
                  | string
                  | null,
                level: (row['level'] ?? row['band'] ?? row['grade_level'] ?? null) as string | null,
                location: (row['location'] ?? row['city'] ?? null) as string | null,
                currency: (row['currency'] ?? 'INR') as string,
                p50: row['p50'] ?? row['median'] ?? row['midpoint'] ?? row['mid'] ?? 0,
              }));
            }
          } catch {
            // Compport unavailable — fall back to PG
          }

          if (bands.length === 0) {
            bands = await tx.salaryBand.findMany({
              where: { tenantId },
              select: { jobFamily: true, level: true, location: true, currency: true, p50: true },
            });
          }

          // Calculate compa-ratio for each employee
          const employeesWithCompaRatio = employees
            .map((emp) => {
              // Find matching salary band — flexible matching
              const band = bands.find(
                (b) =>
                  (b.jobFamily === emp.jobFamily ||
                    b.jobFamily === emp.department ||
                    !b.jobFamily) &&
                  (b.level === emp.level || !b.level) &&
                  (b.location === emp.location || !b.location),
              );

              if (!band || !band.p50 || Number(band.p50) === 0) {
                return null;
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
              message:
                'No employees matched to salary bands. Pay range data may need different job family/level mapping.',
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
    // Read directly from Compport MySQL — employee_lti_details
    return this.compportData.getEmployeeLtiDetails(tenantId, undefined, filters.limit ?? 50);
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
    // Read directly from Compport MySQL — payrange_market_data
    return this.compportData.getPayRanges(tenantId, filters.limit ?? 100);
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

  // ─── Performance Analytics (Copilot Charts) ────────────────

  async queryPerformanceAnalytics(
    tenantId: string,
    filters: {
      metric: string;
      department?: string;
      groupBy?: string;
    },
  ): Promise<unknown> {
    const baseWhere: Prisma.EmployeeWhereInput = {
      tenantId,
      performanceRating: { not: null },
    };
    if (filters.department) baseWhere.department = filters.department;

    return this.db.forTenant(tenantId, async (tx) => {
      switch (filters.metric) {
        case 'rating_distribution': {
          const employees = await tx.employee.findMany({
            where: baseWhere,
            select: { performanceRating: true },
          });
          const buckets = new Map<string, number>();
          for (const emp of employees) {
            const rating = Number(emp.performanceRating);
            const key = rating.toFixed(1);
            buckets.set(key, (buckets.get(key) ?? 0) + 1);
          }
          const chartData = Array.from(buckets.entries())
            .map(([rating, count]) => ({ rating, count }))
            .sort((a, b) => Number(a.rating) - Number(b.rating));
          return {
            chartType: 'bar',
            title: 'Performance Rating Distribution',
            xKey: 'rating',
            yKeys: ['count'],
            data: chartData,
          };
        }

        case 'avg_rating_by_department': {
          const grouped = await tx.employee.groupBy({
            by: ['department'],
            where: baseWhere,
            _avg: { performanceRating: true },
            _count: true,
          });
          const chartData = grouped
            .map((g) => ({
              department: g.department,
              avgRating: g._avg.performanceRating
                ? Math.round(Number(g._avg.performanceRating) * 100) / 100
                : 0,
              count: g._count,
            }))
            .sort((a, b) => b.avgRating - a.avgRating);
          return {
            chartType: 'bar',
            title: 'Average Performance Rating by Department',
            xKey: 'department',
            yKeys: ['avgRating'],
            data: chartData,
          };
        }

        case 'avg_rating_by_level': {
          const grouped = await tx.employee.groupBy({
            by: ['level'],
            where: baseWhere,
            _avg: { performanceRating: true },
            _count: true,
          });
          const chartData = grouped
            .map((g) => ({
              level: g.level,
              avgRating: g._avg.performanceRating
                ? Math.round(Number(g._avg.performanceRating) * 100) / 100
                : 0,
              count: g._count,
            }))
            .sort((a, b) => b.avgRating - a.avgRating);
          return {
            chartType: 'bar',
            title: 'Average Performance Rating by Level',
            xKey: 'level',
            yKeys: ['avgRating'],
            data: chartData,
          };
        }

        case 'performance_vs_salary': {
          const employees = await tx.employee.findMany({
            where: baseWhere,
            select: {
              performanceRating: true,
              baseSalary: true,
              department: true,
              level: true,
            },
            take: 500,
          });
          const chartData = employees.map((emp) => ({
            rating: Number(emp.performanceRating),
            salary: Number(emp.baseSalary),
            department: emp.department,
            level: emp.level,
          }));
          return {
            chartType: 'bar',
            title: 'Performance Rating vs Base Salary',
            xKey: 'rating',
            yKeys: ['salary'],
            data: chartData,
          };
        }

        case 'rating_summary': {
          const result = await tx.employee.aggregate({
            where: baseWhere,
            _avg: { performanceRating: true },
            _min: { performanceRating: true },
            _max: { performanceRating: true },
            _count: true,
          });
          return {
            avgRating: result._avg.performanceRating
              ? Math.round(Number(result._avg.performanceRating) * 100) / 100
              : null,
            minRating: result._min.performanceRating ? Number(result._min.performanceRating) : null,
            maxRating: result._max.performanceRating ? Number(result._max.performanceRating) : null,
            totalEmployees: result._count,
          };
        }

        default:
          return { error: `Unknown performance metric: ${filters.metric}` };
      }
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

  // ─── Data Scope Adapter ─────────────────────────────────

  /**
   * Build a scoped CopilotDbAdapter that wraps `this` but applies
   * data-scope filtering to employee queries. This is request-safe
   * because each streamChat invocation gets its own closure.
   */
  private buildScopedAdapter(scope: DataScope): CopilotDbAdapter {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      // Delegate all methods to `this` — Compport MySQL reads are
      // already handled in the adapter methods themselves
      queryCompensation: self.queryCompensation.bind(self),
      queryRules: self.queryRules.bind(self),
      queryCycles: self.queryCycles.bind(self),
      queryPayroll: self.queryPayroll.bind(self),
      queryAnalytics: self.queryAnalytics.bind(self),
      queryBenefits: self.queryBenefits.bind(self),
      queryEquity: self.queryEquity.bind(self),
      querySalaryBands: self.querySalaryBands.bind(self),
      queryNotifications: self.queryNotifications.bind(self),
      queryTeam: self.queryTeam.bind(self),
      queryPerformanceAnalytics: self.queryPerformanceAnalytics.bind(self),
      approveRecommendation: self.approveRecommendation.bind(self),
      rejectRecommendation: self.rejectRecommendation.bind(self),
      requestLetter: self.requestLetter.bind(self),
      get ruleManagement() {
        return self.ruleManagement;
      },
      get mirrorAdapter() {
        return self.mirrorAdapter;
      },

      // Override queryEmployees with scope filter
      async queryEmployees(tenantId, filters) {
        const where: Prisma.EmployeeWhereInput = { ...scope.employeeFilter };
        if (filters.department) where.department = filters.department;
        if (filters.level) where.level = filters.level;
        if (filters.location) where.location = filters.location;
        if (filters.managerId) where.managerId = filters.managerId;
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

        return self.db.forTenant(tenantId, (tx) =>
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
              managerId: true,
              gender: true,
              jobFamily: true,
              performanceRating: true,
              compaRatio: true,
              terminationDate: true,
              isPeopleManager: true,
              metadata: true,
              manager: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  employeeCode: true,
                },
              },
            },
          }),
        );
      },
    };
  }
}
