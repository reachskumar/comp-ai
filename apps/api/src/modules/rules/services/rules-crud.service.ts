import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { BaseCrudService, type PaginationParams, type PaginatedResult } from '../../../common';

/**
 * CRUD service for RuleSet entities. Extends BaseCrudService for
 * tenant-scoped pagination, find, create, update, delete.
 */
@Injectable()
export class RuleSetCrudService extends BaseCrudService {
  protected readonly modelName = 'ruleSet';

  constructor(db: DatabaseService) {
    super(db);
  }

  /**
   * List rule sets with optional status filter.
   */
  async getRuleSets(
    tenantId: string,
    pagination: PaginationParams = {},
    status?: string,
  ): Promise<PaginatedResult<unknown>> {
    const where: Record<string, unknown> = {};
    if (status) {
      where['status'] = status;
    }
    return this.findAll(tenantId, pagination, where);
  }

  /**
   * Get a single rule set with its rules included.
   */
  async getRuleSet(tenantId: string, id: string) {
    const ruleSet = await this.model.findFirst({
      where: { id, tenantId },
      include: { rules: { orderBy: { priority: 'asc' } } },
    });

    if (!ruleSet) {
      throw new NotFoundException(`RuleSet with id ${id} not found`);
    }

    return ruleSet;
  }

  /**
   * Create a rule set, optionally with initial rules.
   */
  async createRuleSet(
    tenantId: string,
    data: {
      name: string;
      description?: string;
      effectiveDate?: string;
      rules?: Array<{
        name: string;
        ruleType: string;
        priority?: number;
        conditions?: Record<string, unknown>[];
        actions?: Record<string, unknown>[];
        metadata?: Record<string, unknown>;
        enabled?: boolean;
      }>;
    },
  ) {
    return this.model.create({
      data: {
        tenantId,
        name: data.name,
        description: data.description,
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : undefined,
        rules: data.rules?.length
          ? {
              create: data.rules.map((r) => ({
                name: r.name,
                ruleType: r.ruleType,
                priority: r.priority ?? 0,
                conditions: r.conditions ?? {},
                actions: r.actions ?? {},
                metadata: r.metadata ?? {},
                enabled: r.enabled ?? true,
              })),
            }
          : undefined,
      },
      include: { rules: true },
    });
  }
}

/**
 * CRUD service for Rule entities within a RuleSet.
 */
@Injectable()
export class RuleCrudService {
  constructor(private readonly db: DatabaseService) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get ruleModel(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db.client as any).rule;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get ruleSetModel(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db.client as any).ruleSet;
  }

  /**
   * Verify the rule set belongs to the tenant.
   */
  private async verifyRuleSet(tenantId: string, ruleSetId: string) {
    const ruleSet = await this.ruleSetModel.findFirst({
      where: { id: ruleSetId, tenantId },
    });
    if (!ruleSet) {
      throw new NotFoundException(`RuleSet with id ${ruleSetId} not found`);
    }
    return ruleSet;
  }

  async addRule(
    tenantId: string,
    ruleSetId: string,
    data: {
      name: string;
      ruleType: string;
      priority?: number;
      conditions?: Record<string, unknown>[];
      actions?: Record<string, unknown>[];
      metadata?: Record<string, unknown>;
      enabled?: boolean;
    },
  ) {
    await this.verifyRuleSet(tenantId, ruleSetId);
    return this.ruleModel.create({
      data: {
        ruleSetId,
        name: data.name,
        ruleType: data.ruleType,
        priority: data.priority ?? 0,
        conditions: data.conditions ?? {},
        actions: data.actions ?? {},
        metadata: data.metadata ?? {},
        enabled: data.enabled ?? true,
      },
    });
  }

  async updateRule(
    tenantId: string,
    ruleSetId: string,
    ruleId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>,
  ) {
    await this.verifyRuleSet(tenantId, ruleSetId);

    const rule = await this.ruleModel.findFirst({
      where: { id: ruleId, ruleSetId },
    });
    if (!rule) {
      throw new NotFoundException(`Rule with id ${ruleId} not found`);
    }

    return this.ruleModel.update({
      where: { id: ruleId },
      data,
    });
  }

  async deleteRule(tenantId: string, ruleSetId: string, ruleId: string) {
    await this.verifyRuleSet(tenantId, ruleSetId);

    const rule = await this.ruleModel.findFirst({
      where: { id: ruleId, ruleSetId },
    });
    if (!rule) {
      throw new NotFoundException(`Rule with id ${ruleId} not found`);
    }

    return this.ruleModel.delete({
      where: { id: ruleId },
    });
  }
}

