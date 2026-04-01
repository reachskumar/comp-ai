import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database';
import { MarketDataAgeingService } from '../benchmarking/services/market-data-ageing.service';
import {
  buildSimulationGraph,
  streamGraphToSSE,
  invokeSimulationGraph,
  type SimulationDbAdapter,
  type SSEEvent,
} from '@compensation/ai';
import { HumanMessage } from '@langchain/core/messages';
import { evaluateRules } from '@compensation/shared';
import type { EmployeeData, RuleSet, Rule } from '@compensation/shared';
import { DataScopeService, type DataScope } from '../../common';

@Injectable()
export class SimulationService implements SimulationDbAdapter {
  private readonly logger = new Logger(SimulationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly marketDataAgeing: MarketDataAgeingService,
    private readonly dataScopeService: DataScopeService,
  ) {}

  // ─── Graph Invocation ──────────────────────────────────────

  async runSimulation(
    tenantId: string,
    userId: string,
    prompt: string,
    role?: string,
  ): Promise<{
    id: string;
    response: string;
    affectedCount: number | null;
    totalCostDelta: number | null;
    budgetImpactPct: number | null;
  }> {
    this.logger.log(`Simulation: tenant=${tenantId} user=${userId}`);

    // Create scenario record
    const scenario = await this.db.forTenant(tenantId, (tx) =>
      tx.simulationScenario.create({
        data: { tenantId, userId, prompt, status: 'RUNNING', startedAt: new Date() },
      }),
    );

    try {
      // Resolve data scope and build scoped adapter
      const dbAdapter = role
        ? await this.buildScopedAdapter(tenantId, userId, role)
        : (this as SimulationDbAdapter);

      const result = await invokeSimulationGraph(
        { tenantId, userId, message: prompt, conversationId: `sim-${scenario.id}` },
        dbAdapter,
      );

      // Update scenario with results
      await this.db.forTenant(tenantId, (tx) =>
        tx.simulationScenario.update({
          where: { id: scenario.id },
          data: {
            status: 'COMPLETED',
            response: result.response,
            completedAt: new Date(),
          },
        }),
      );

      return {
        id: scenario.id,
        response: result.response,
        affectedCount: null,
        totalCostDelta: null,
        budgetImpactPct: null,
      };
    } catch (error) {
      await this.db.forTenant(tenantId, (tx) =>
        tx.simulationScenario.update({
          where: { id: scenario.id },
          data: {
            status: 'FAILED',
            errorMsg: error instanceof Error ? error.message : 'Unknown error',
          },
        }),
      );
      throw error;
    }
  }

  async *streamSimulation(
    tenantId: string,
    userId: string,
    prompt: string,
    role?: string,
  ): AsyncGenerator<SSEEvent> {
    this.logger.log(`Simulation stream: tenant=${tenantId} user=${userId}`);

    const dbAdapter = role
      ? await this.buildScopedAdapter(tenantId, userId, role)
      : (this as SimulationDbAdapter);
    const { graph } = await buildSimulationGraph(dbAdapter, tenantId);

    const threadId = `simulation-${tenantId}-${userId}-${Date.now()}`;
    const config = { configurable: { thread_id: threadId } };

    const stream = graph.streamEvents(
      {
        tenantId,
        userId,
        messages: [new HumanMessage(prompt)],
        metadata: {},
      },
      { ...config, version: 'v2' as const },
    );

    yield* streamGraphToSSE(stream, {
      graphName: 'simulation-graph',
      runId: threadId,
    });
  }

  async compareSimulations(
    tenantId: string,
    userId: string,
    promptA: string,
    promptB: string,
    role?: string,
  ): Promise<{
    scenarioA: { id: string; response: string };
    scenarioB: { id: string; response: string };
  }> {
    const [resultA, resultB] = await Promise.all([
      this.runSimulation(tenantId, userId, promptA, role),
      this.runSimulation(tenantId, userId, promptB, role),
    ]);

    return {
      scenarioA: { id: resultA.id, response: resultA.response },
      scenarioB: { id: resultB.id, response: resultB.response },
    };
  }

  async getScenarioHistory(tenantId: string, userId: string, limit = 20) {
    return this.db.forTenant(tenantId, (tx) =>
      tx.simulationScenario.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    );
  }

  // ─── SimulationDbAdapter Implementation ────────────────────

  async queryEmployeesForScenario(
    tenantId: string,
    filters: {
      department?: string;
      level?: string;
      location?: string;
      minSalary?: number;
      maxSalary?: number;
      performanceRating?: number;
      limit?: number;
    },
  ): Promise<unknown[]> {
    const where: Record<string, unknown> = { tenantId };
    if (filters.department) where['department'] = filters.department;
    if (filters.level) where['level'] = filters.level;
    if (filters.location) where['location'] = filters.location;
    if (filters.minSalary != null || filters.maxSalary != null) {
      const salary: Record<string, unknown> = {};
      if (filters.minSalary != null) salary['gte'] = filters.minSalary;
      if (filters.maxSalary != null) salary['lte'] = filters.maxSalary;
      where['baseSalary'] = salary;
    }

    const employees = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.findMany({
        where: where as never,
        take: filters.limit ?? 500,
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
          metadata: true,
        },
      }),
    );

    // Filter by performanceRating from metadata if requested
    if (filters.performanceRating != null) {
      return employees.filter((e) => {
        const meta = (e.metadata ?? {}) as Record<string, unknown>;
        const rating = Number(meta['performanceRating'] ?? 0);
        return rating >= (filters.performanceRating ?? 0);
      });
    }

    return employees;
  }

  async runRulesSimulation(
    tenantId: string,
    params: {
      ruleSetId?: string;
      adjustmentType: string;
      adjustmentValue: number;
      employeeIds?: string[];
      department?: string;
      level?: string;
    },
  ): Promise<unknown> {
    // Build employee query
    const where: Record<string, unknown> = { tenantId };
    if (params.employeeIds?.length) where['id'] = { in: params.employeeIds };
    if (params.department) where['department'] = params.department;
    if (params.level) where['level'] = params.level;

    // Load employees and optionally a rule set in a single tenant-scoped transaction
    const { employees, loadedRuleSet } = await this.db.forTenant(tenantId, async (tx) => {
      const emps = await tx.employee.findMany({
        where: where as never,
        take: 500,
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          department: true,
          level: true,
          location: true,
          baseSalary: true,
          hireDate: true,
          metadata: true,
        },
      });

      let rs = null;
      if (params.ruleSetId) {
        rs = await tx.ruleSet.findFirst({
          where: { id: params.ruleSetId, tenantId },
          include: { rules: true },
        });
      }

      return { employees: emps, loadedRuleSet: rs };
    });

    // Map adjustment type to rule action
    const actionMap: Record<string, { type: string; paramKey: string }> = {
      merit_percent: { type: 'setMerit', paramKey: 'percentage' },
      bonus_percent: { type: 'setBonus', paramKey: 'percentage' },
      bonus_flat: { type: 'setBonus', paramKey: 'amount' },
      lti_percent: { type: 'setLTI', paramKey: 'percentage' },
      salary_cap: { type: 'applyCap', paramKey: 'amount' },
    };

    const mapping = actionMap[params.adjustmentType] ?? {
      type: 'setMerit',
      paramKey: 'percentage',
    };

    // Build synthetic rule set
    const syntheticRuleSet: RuleSet = {
      id: 'sim-ruleset',
      name: 'Simulation Rule Set',
      rules: [
        {
          id: 'sim-rule-1',
          name: `Simulation: ${params.adjustmentType} ${params.adjustmentValue}`,
          type: (mapping.type.startsWith('set')
            ? mapping.type.replace('set', '').toUpperCase()
            : 'MERIT') as Rule['type'],
          conditions: [],
          actions: [
            {
              type: mapping.type as Rule['actions'][0]['type'],
              params: { [mapping.paramKey]: params.adjustmentValue },
            },
          ],
          priority: 0,
          enabled: true,
        },
      ],
    };

    // If a real ruleSet was loaded, use it
    if (loadedRuleSet) {
      syntheticRuleSet.id = loadedRuleSet.id;
      syntheticRuleSet.name = loadedRuleSet.name;
      syntheticRuleSet.rules = loadedRuleSet.rules.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.ruleType as Rule['type'],
        conditions: Array.isArray(r.conditions)
          ? (r.conditions as unknown as Rule['conditions'])
          : [],
        actions: Array.isArray(r.actions) ? (r.actions as unknown as Rule['actions']) : [],
        priority: r.priority,
        enabled: r.enabled,
      }));
    }

    // Run rules engine for each employee
    let totalCostDelta = 0;
    const results = employees.map((emp) => {
      const empData: EmployeeData = {
        id: emp.id,
        employeeCode: emp.employeeCode,
        department: emp.department,
        level: emp.level,
        location: emp.location ?? undefined,
        baseSalary: Number(emp.baseSalary),
        hireDate: emp.hireDate,
        ...((emp.metadata as Record<string, unknown>) ?? {}),
      };

      const evaluation = evaluateRules(empData, syntheticRuleSet);
      const costDelta = evaluation.totalMerit + evaluation.totalBonus + evaluation.totalLTI;
      totalCostDelta += costDelta;

      return {
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        department: emp.department,
        level: emp.level,
        currentSalary: Number(emp.baseSalary),
        meritIncrease: evaluation.totalMerit,
        bonusAmount: evaluation.totalBonus,
        ltiAmount: evaluation.totalLTI,
        totalDelta: costDelta,
        newSalary: Number(emp.baseSalary) + evaluation.totalMerit,
        blocked: evaluation.blocked,
        flags: evaluation.flags,
        warnings: evaluation.warnings,
      };
    });

    return {
      affectedCount: results.length,
      totalCostDelta,
      averageDelta: results.length > 0 ? totalCostDelta / results.length : 0,
      results,
    };
  }

  async calculateBudgetImpact(
    tenantId: string,
    params: {
      totalCostDelta: number;
      affectedCount: number;
      department?: string;
    },
  ): Promise<unknown> {
    const where: Record<string, unknown> = { tenantId };
    if (params.department) where['department'] = params.department;

    const agg = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.aggregate({
        where: where as never,
        _sum: { baseSalary: true, totalComp: true },
        _count: true,
      }),
    );

    const currentBudget = Number(agg._sum.totalComp ?? agg._sum.baseSalary ?? 0);
    const budgetImpactPct = currentBudget > 0 ? (params.totalCostDelta / currentBudget) * 100 : 0;

    return {
      totalCostDelta: params.totalCostDelta,
      affectedCount: params.affectedCount,
      currentBudget,
      newBudget: currentBudget + params.totalCostDelta,
      budgetImpactPct: Math.round(budgetImpactPct * 100) / 100,
      perEmployeeAverage:
        params.affectedCount > 0 ? Math.round(params.totalCostDelta / params.affectedCount) : 0,
      headcount: agg._count,
    };
  }

  async getMarketData(
    tenantId: string,
    params: {
      department?: string;
      level?: string;
      location?: string;
    },
  ): Promise<unknown> {
    const label =
      [params.department, params.level, params.location].filter(Boolean).join(' / ') || 'All Roles';

    // Try to get real blended market data from salary bands
    if (params.department && params.level) {
      try {
        const blended = await this.marketDataAgeing.getBlendedMarketData(
          tenantId,
          params.department,
          params.level,
          params.location,
        );

        if (blended) {
          return {
            label,
            benchmarks: {
              p10: blended.p10,
              p25: blended.p25,
              p50: blended.p50,
              p75: blended.p75,
              p90: blended.p90,
            },
            source: blended.sources.map((s) => s.sourceName).join(', '),
            sourceCount: blended.sources.length,
            asOfDate: new Date().toISOString().split('T')[0],
            note:
              blended.sources.length > 1
                ? `Blended from ${blended.sources.length} sources with ageing adjustment`
                : 'Single source with ageing adjustment',
          };
        }
      } catch (error) {
        this.logger.warn(`Failed to get blended market data: ${(error as Error).message}`);
      }
    }

    // Fallback: try to find any matching salary band directly
    try {
      const where: Record<string, unknown> = { tenantId };
      if (params.department) where['jobFamily'] = params.department;
      if (params.level) where['level'] = params.level;
      if (params.location) where['location'] = params.location;

      const band = await this.db.forTenant(tenantId, (tx) =>
        tx.salaryBand.findFirst({
          where: where as never,
          orderBy: { effectiveDate: 'desc' },
        }),
      );

      if (band) {
        return {
          label,
          benchmarks: {
            p10: Number(band.p10),
            p25: Number(band.p25),
            p50: Number(band.p50),
            p75: Number(band.p75),
            p90: Number(band.p90),
          },
          source: band.source || 'Salary Band',
          asOfDate: band.effectiveDate.toISOString().split('T')[0],
          note: 'From salary band data',
        };
      }
    } catch (error) {
      this.logger.warn(`Failed to query salary bands: ${(error as Error).message}`);
    }

    // Final fallback: placeholder
    return {
      label,
      benchmarks: {
        p25: 65000,
        p50: 85000,
        p75: 110000,
        p90: 140000,
      },
      source: 'Internal Benchmark (placeholder)',
      asOfDate: new Date().toISOString().split('T')[0],
      note: 'No market data available. Upload survey data from Mercer, WTW, or other providers.',
    };
  }

  // ─── Data Scope Adapter ─────────────────────────────────

  /**
   * Build a scoped SimulationDbAdapter that applies data-scope
   * filtering to employee queries. Each invocation gets its own closure.
   */
  private async buildScopedAdapter(
    tenantId: string,
    userId: string,
    role: string,
  ): Promise<SimulationDbAdapter> {
    const scope = await this.dataScopeService.resolveScope(tenantId, userId, role);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    return {
      // Delegate non-employee methods
      runRulesSimulation: self.runRulesSimulation.bind(self),
      calculateBudgetImpact: self.calculateBudgetImpact.bind(self),
      getMarketData: self.getMarketData.bind(self),

      // Override employee query with scope
      async queryEmployeesForScenario(tid, filters) {
        const where: Record<string, unknown> = { ...scope.employeeFilter };
        if (filters.department) where['department'] = filters.department;
        if (filters.level) where['level'] = filters.level;
        if (filters.location) where['location'] = filters.location;
        if (filters.minSalary != null || filters.maxSalary != null) {
          const salary: Record<string, unknown> = {};
          if (filters.minSalary != null) salary['gte'] = filters.minSalary;
          if (filters.maxSalary != null) salary['lte'] = filters.maxSalary;
          where['baseSalary'] = salary;
        }

        const employees = await self.db.forTenant(tid, (tx) =>
          tx.employee.findMany({
            where: where as never,
            take: filters.limit ?? 500,
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
              metadata: true,
            },
          }),
        );

        if (filters.performanceRating != null) {
          return employees.filter((e) => {
            const meta = (e.metadata ?? {}) as Record<string, unknown>;
            const rating = Number(meta['performanceRating'] ?? 0);
            return rating >= (filters.performanceRating ?? 0);
          });
        }

        return employees;
      },
    };
  }
}
