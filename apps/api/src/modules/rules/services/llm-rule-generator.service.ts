import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import {
  invokeRuleAnalysisGraph,
  type RuleManagementDbAdapter,
  type RuleAnalysisInput,
} from '@compensation/ai';
import type { GenerateRulesParams, GeneratedRule } from './rule-generator.service';

/**
 * LLM-powered rule analysis and generation service.
 *
 * Wraps the rule-analysis LangGraph agent to provide:
 * 1. Natural language rule analysis (explain rules in plain English)
 * 2. Rule generation from chat instructions
 * 3. Rule set comparison
 *
 * Uses the same RuleManagementDbAdapter pattern as the copilot —
 * the AI package stays DB-agnostic, and this service bridges
 * the gap by implementing the adapter with Prisma queries.
 */
@Injectable()
export class LlmRuleGeneratorService {
  private readonly logger = new Logger(LlmRuleGeneratorService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Build the DB adapter that the AI graph needs.
   * This keeps Prisma queries in the API layer.
   */
  private buildDbAdapter(): RuleManagementDbAdapter {
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
        // Verify ownership
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
        // Delegate to deterministic generator logic
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
          message: 'Use generate_from_source endpoint for deterministic generation',
        };
      },
    };
  }

  /**
   * Analyse a rule set using LLM — returns a plain English explanation.
   */
  async analyzeRuleSet(
    tenantId: string,
    userId: string,
    ruleSetId: string,
    userRole?: string,
  ): Promise<string> {
    const input: RuleAnalysisInput = {
      tenantId,
      userId,
      userRole,
      message: `Analyze rule set "${ruleSetId}". Fetch it and explain every rule in plain English, including who is affected and what compensation actions are taken.`,
    };
    const result = await invokeRuleAnalysisGraph(input, this.buildDbAdapter());
    return result.response;
  }

  /**
   * Compare two rule sets using LLM — returns a diff summary.
   */
  async compareRuleSets(
    tenantId: string,
    userId: string,
    ruleSetIdA: string,
    ruleSetIdB: string,
    userRole?: string,
  ): Promise<string> {
    const input: RuleAnalysisInput = {
      tenantId,
      userId,
      userRole,
      message: `Compare rule sets "${ruleSetIdA}" and "${ruleSetIdB}". Fetch both, list differences (added/removed/changed rules), and summarise budget impact.`,
    };
    const result = await invokeRuleAnalysisGraph(input, this.buildDbAdapter());
    return result.response;
  }

  /**
   * Generate rules from a natural language instruction via LLM.
   *
   * Example: "Create a merit rule set that gives 5% to anyone rated 4+
   * with compa-ratio below 0.9, 3% for rating 3, and 0% for rating 1-2"
   */
  async generateFromInstruction(
    tenantId: string,
    userId: string,
    instruction: string,
    userRole?: string,
  ): Promise<string> {
    const input: RuleAnalysisInput = {
      tenantId,
      userId,
      userRole,
      message: instruction,
    };
    const result = await invokeRuleAnalysisGraph(input, this.buildDbAdapter());
    return result.response;
  }
}
