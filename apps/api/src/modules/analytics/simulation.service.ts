import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database';
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

@Injectable()
export class SimulationService implements SimulationDbAdapter {
  private readonly logger = new Logger(SimulationService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Graph Invocation ──────────────────────────────────────

  async runSimulation(
    tenantId: string,
    userId: string,
    prompt: string,
  ): Promise<{ id: string; response: string; affectedCount: number | null; totalCostDelta: number | null; budgetImpactPct: number | null }> {
    this.logger.log(`Simulation: tenant=${tenantId} user=${userId}`);

    // Create scenario record
    const scenario = await this.db.client.simulationScenario.create({
      data: { tenantId, userId, prompt, status: 'RUNNING', startedAt: new Date() },
    });

    try {
      const result = await invokeSimulationGraph(
        { tenantId, userId, message: prompt },
        this,
      );

      // Update scenario with results
      await this.db.client.simulationScenario.update({
        where: { id: scenario.id },
        data: {
          status: 'COMPLETED',
          response: result.response,
          completedAt: new Date(),
        },
      });

      return {
        id: scenario.id,
        response: result.response,
        affectedCount: null,
        totalCostDelta: null,
        budgetImpactPct: null,
      };
    } catch (error) {
      await this.db.client.simulationScenario.update({
        where: { id: scenario.id },
        data: {
          status: 'FAILED',
          errorMsg: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  }

  async *streamSimulation(
    tenantId: string,
    userId: string,
    prompt: string,
  ): AsyncGenerator<SSEEvent> {
    this.logger.log(`Simulation stream: tenant=${tenantId} user=${userId}`);

    const { graph } = await buildSimulationGraph(this, tenantId);

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
  ): Promise<{ scenarioA: { id: string; response: string }; scenarioB: { id: string; response: string } }> {
    const [resultA, resultB] = await Promise.all([
      this.runSimulation(tenantId, userId, promptA),
      this.runSimulation(tenantId, userId, promptB),
    ]);

    return {
      scenarioA: { id: resultA.id, response: resultA.response },
      scenarioB: { id: resultB.id, response: resultB.response },
    };
  }

  async getScenarioHistory(tenantId: string, userId: string, limit = 20) {
    return this.db.client.simulationScenario.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ─── SimulationDbAdapter Implementation ────────────────────

  async queryEmployeesForScenario(tenantId: string, filters: {
    department?: string; level?: string; location?: string;
    minSalary?: number; maxSalary?: number; performanceRating?: number; limit?: number;
  }): Promise<unknown[]> {
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

    const employees = await this.db.client.employee.findMany({
      where: where as never,
      take: filters.limit ?? 500,
      select: {
        id: true, employeeCode: true, firstName: true, lastName: true,
        department: true, level: true, location: true,
        baseSalary: true, totalComp: true, currency: true,
        hireDate: true, metadata: true,
      },
    });

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

  async runRulesSimulation(tenantId: string, params: {
    ruleSetId?: string; adjustmentType: string; adjustmentValue: number;
    employeeIds?: string[]; department?: string; level?: string;
  }): Promise<unknown> {
    // Build employee query
    const where: Record<string, unknown> = { tenantId };
    if (params.employeeIds?.length) where['id'] = { in: params.employeeIds };
    if (params.department) where['department'] = params.department;
    if (params.level) where['level'] = params.level;

    const employees = await this.db.client.employee.findMany({
      where: where as never,
      take: 500,
      select: {
        id: true, employeeCode: true, firstName: true, lastName: true,
        department: true, level: true, location: true,
        baseSalary: true, hireDate: true, metadata: true,
      },
    });

    // Map adjustment type to rule action
    const actionMap: Record<string, { type: string; paramKey: string }> = {
      merit_percent: { type: 'setMerit', paramKey: 'percentage' },
      bonus_percent: { type: 'setBonus', paramKey: 'percentage' },
      bonus_flat: { type: 'setBonus', paramKey: 'amount' },
      lti_percent: { type: 'setLTI', paramKey: 'percentage' },
      salary_cap: { type: 'applyCap', paramKey: 'amount' },
    };

    const mapping = actionMap[params.adjustmentType] ?? { type: 'setMerit', paramKey: 'percentage' };

    // Build synthetic rule set
    const syntheticRuleSet: RuleSet = {
      id: 'sim-ruleset',
      name: 'Simulation Rule Set',
      rules: [{
        id: 'sim-rule-1',
        name: `Simulation: ${params.adjustmentType} ${params.adjustmentValue}`,
        type: (mapping.type.startsWith('set') ? mapping.type.replace('set', '').toUpperCase() : 'MERIT') as Rule['type'],
        conditions: [],
        actions: [{ type: mapping.type as Rule['actions'][0]['type'], params: { [mapping.paramKey]: params.adjustmentValue } }],
        priority: 0,
        enabled: true,
      }],
    };

    // If a real ruleSetId is provided, try to load it
    if (params.ruleSetId) {
      const ruleSet = await this.db.client.ruleSet.findFirst({
        where: { id: params.ruleSetId, tenantId },
        include: { rules: true },
      });
      if (ruleSet) {
        syntheticRuleSet.id = ruleSet.id;
        syntheticRuleSet.name = ruleSet.name;
        syntheticRuleSet.rules = ruleSet.rules.map((r) => ({
          id: r.id,
          name: r.name,
          type: r.ruleType as Rule['type'],
          conditions: Array.isArray(r.conditions) ? r.conditions as unknown as Rule['conditions'] : [],
          actions: Array.isArray(r.actions) ? r.actions as unknown as Rule['actions'] : [],
          priority: r.priority,
          enabled: r.enabled,
        }));
      }
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
        ...(emp.metadata as Record<string, unknown> ?? {}),
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

  async calculateBudgetImpact(tenantId: string, params: {
    totalCostDelta: number; affectedCount: number; department?: string;
  }): Promise<unknown> {
    const where: Record<string, unknown> = { tenantId };
    if (params.department) where['department'] = params.department;

    const agg = await this.db.client.employee.aggregate({
      where: where as never,
      _sum: { baseSalary: true, totalComp: true },
      _count: true,
    });

    const currentBudget = Number(agg._sum.totalComp ?? agg._sum.baseSalary ?? 0);
    const budgetImpactPct = currentBudget > 0
      ? (params.totalCostDelta / currentBudget) * 100
      : 0;

    return {
      totalCostDelta: params.totalCostDelta,
      affectedCount: params.affectedCount,
      currentBudget,
      newBudget: currentBudget + params.totalCostDelta,
      budgetImpactPct: Math.round(budgetImpactPct * 100) / 100,
      perEmployeeAverage: params.affectedCount > 0
        ? Math.round(params.totalCostDelta / params.affectedCount)
        : 0,
      headcount: agg._count,
    };
  }

  async getMarketData(_tenantId: string, params: {
    department?: string; level?: string; location?: string;
  }): Promise<unknown> {
    // Market benchmarks — placeholder data; in production this would query
    // an external market-data provider or an internal benchmarks table.
    const label = [params.department, params.level, params.location]
      .filter(Boolean)
      .join(' / ') || 'All Roles';

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
      note: 'Market data is illustrative. Connect a market-data provider for live benchmarks.',
    };
  }
}
