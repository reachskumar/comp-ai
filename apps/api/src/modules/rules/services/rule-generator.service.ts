import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database';

export interface GenerateRulesParams {
  sourceRuleSetId: string;
  newName: string;
  newDescription?: string;
  effectiveDate?: string;
  /** Budget adjustment factor (e.g., 1.05 = 5% more budget) */
  budgetFactor?: number;
  /** Market adjustment factor (e.g., 1.03 = 3% market increase) */
  marketFactor?: number;
  /** Whether to increase performance differentiation */
  increasePerformanceDiff?: boolean;
}

export interface GeneratedRule {
  name: string;
  ruleType: string;
  priority: number;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  metadata: Record<string, unknown>;
  enabled: boolean;
  /** What changed from the source rule */
  aiNote: string;
}

@Injectable()
export class RuleGeneratorService {
  private readonly logger = new Logger(RuleGeneratorService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Clone a rule set and apply AI-based adjustments for a new cycle.
   *
   * Adjustment logic:
   * 1. Budget factor: scales merit/bonus percentages up or down
   * 2. Market factor: adjusts salary-based thresholds and caps
   * 3. Performance differentiation: widens the spread between perf levels
   */
  async generateFromSource(
    tenantId: string,
    params: GenerateRulesParams,
  ): Promise<{ ruleSet: unknown; generatedRules: GeneratedRule[] }> {
    const budgetFactor = params.budgetFactor ?? 1.0;
    const marketFactor = params.marketFactor ?? 1.0;
    const perfDiff = params.increasePerformanceDiff ?? false;

    // Fetch source rule set with rules
    const source = await this.db.forTenant(tenantId, (tx) =>
      tx.ruleSet.findFirst({
        where: { id: params.sourceRuleSetId, tenantId },
        include: { rules: { orderBy: { priority: 'asc' } } },
      }),
    );

    if (!source) {
      throw new NotFoundException(`Source rule set ${params.sourceRuleSetId} not found`);
    }

    // Generate adjusted rules
    const generatedRules: GeneratedRule[] = source.rules.map((rule) => {
      const conditions = rule.conditions as Record<string, unknown>;
      const actions = rule.actions as Record<string, unknown>;
      const metadata = rule.metadata as Record<string, unknown>;
      const notes: string[] = [];

      const newActions = { ...actions };
      const newConditions = { ...conditions };

      // Adjust merit/bonus percentages by budget factor
      if (rule.ruleType === 'MERIT' || rule.ruleType === 'BONUS') {
        for (const key of ['percentage', 'meritPct', 'bonusPct', 'amount']) {
          if (typeof newActions[key] === 'number') {
            const old = newActions[key] as number;
            newActions[key] = Math.round(old * budgetFactor * 10) / 10;
            notes.push(`${key}: ${old}% → ${newActions[key]}% (budget factor: ${budgetFactor}x)`);
          }
        }
      }

      // Adjust cap/floor values
      if (rule.ruleType === 'CAP' || rule.ruleType === 'FLOOR') {
        for (const key of ['capAt', 'floorAt', 'maxIncreasePct', 'minIncreasePct', 'maxBonusPct']) {
          if (typeof newActions[key] === 'number') {
            const old = newActions[key] as number;
            newActions[key] = Math.round(old * budgetFactor * 10) / 10;
            notes.push(`${key}: ${old} → ${newActions[key]} (budget factor: ${budgetFactor}x)`);
          }
          if (typeof newConditions[key] === 'number') {
            const old = newConditions[key] as number;
            newConditions[key] = Math.round(old * budgetFactor * 10) / 10;
            notes.push(`condition ${key}: ${old} → ${newConditions[key]}`);
          }
        }
      }

      // Adjust salary-based thresholds by market factor
      for (const key of ['minSalary', 'maxSalary', 'salaryThreshold']) {
        if (typeof newConditions[key] === 'number') {
          const old = newConditions[key] as number;
          newConditions[key] = Math.round(old * marketFactor);
          notes.push(
            `${key}: $${old.toLocaleString()} → $${(newConditions[key] as number).toLocaleString()} (market adj: ${marketFactor}x)`,
          );
        }
      }

      // Increase performance differentiation
      if (perfDiff && rule.ruleType === 'MERIT') {
        if (typeof newActions['percentage'] === 'number') {
          const pct = newActions['percentage'] as number;
          // Check if this is a high-performer rule (heuristic)
          const condStr = JSON.stringify(newConditions).toLowerCase();
          if (
            condStr.includes('exceeds') ||
            condStr.includes('exceptional') ||
            condStr.includes('"gte":4') ||
            condStr.includes('"gte": 4')
          ) {
            newActions['percentage'] = Math.round(pct * 1.15 * 10) / 10;
            notes.push(
              `+15% perf differentiation for high performers: ${pct}% → ${newActions['percentage']}%`,
            );
          } else if (
            condStr.includes('below') ||
            condStr.includes('unsatisfactory') ||
            condStr.includes('"lte":2') ||
            condStr.includes('"lte": 2')
          ) {
            newActions['percentage'] = Math.round(pct * 0.85 * 10) / 10;
            notes.push(
              `-15% perf differentiation for low performers: ${pct}% → ${newActions['percentage']}%`,
            );
          }
        }
      }

      if (notes.length === 0) {
        notes.push('No adjustments needed — rule carried forward as-is');
      }

      return {
        name: rule.name,
        ruleType: rule.ruleType,
        priority: rule.priority,
        conditions: newConditions,
        actions: newActions,
        metadata: { ...metadata, sourceRuleId: rule.id, aiGenerated: true },
        enabled: rule.enabled,
        aiNote: notes.join('; '),
      };
    });

    // Create the new rule set with generated rules
    const newRuleSet = await this.db.forTenant(tenantId, (tx) =>
      tx.ruleSet.create({
        data: {
          tenantId,
          name: params.newName,
          description: params.newDescription ?? `AI-generated from "${source.name}"`,
          effectiveDate: params.effectiveDate ? new Date(params.effectiveDate) : undefined,
          version: source.version + 1,
          rules: {
            create: generatedRules.map((r) => ({
              name: r.name,
              ruleType: r.ruleType as any,
              priority: r.priority,
              conditions: r.conditions as any,
              actions: r.actions as any,
              metadata: r.metadata as any,
              enabled: r.enabled,
            })),
          },
        },
        include: { rules: { orderBy: { priority: 'asc' } } },
      }),
    );

    this.logger.log(
      `Generated rule set "${params.newName}" from "${source.name}" with ${generatedRules.length} rules`,
    );

    return { ruleSet: newRuleSet, generatedRules };
  }
}
