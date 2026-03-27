/**
 * Rule management tools — LangGraph tools for rule analysis, generation,
 * and CRUD operations via the AI Compensation Copilot.
 *
 * These tools enable the copilot to:
 * 1. Analyze existing rules and explain them in plain English
 * 2. Generate new rules from natural language instructions
 * 3. Compare rule sets across cycles
 * 4. Create / modify / delete rules via chat
 */

import { z } from 'zod';
import { createDomainTool } from '../tools.js';
import type { StructuredToolInterface } from '@langchain/core/tools';

/* ─── Database Adapter ──────────────────────────────────────── */

export interface RuleManagementDbAdapter {
  /** Fetch a rule set with all its rules */
  getRuleSet(tenantId: string, ruleSetId: string): Promise<unknown>;

  /** List rule sets (with optional filters) */
  listRuleSets(
    tenantId: string,
    filters: { status?: string; search?: string; limit?: number },
  ): Promise<unknown[]>;

  /** Create a new rule set with rules */
  createRuleSet(
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
  ): Promise<unknown>;

  /** Add a rule to an existing rule set */
  addRule(
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
  ): Promise<unknown>;

  /** Update an existing rule */
  updateRule(
    tenantId: string,
    ruleSetId: string,
    ruleId: string,
    data: Record<string, unknown>,
  ): Promise<unknown>;

  /** Delete a rule */
  deleteRule(tenantId: string, ruleSetId: string, ruleId: string): Promise<unknown>;

  /** Clone a rule set with deterministic adjustments (budget/market factors) */
  generateFromSource(
    tenantId: string,
    params: {
      sourceRuleSetId: string;
      newName: string;
      newDescription?: string;
      effectiveDate?: string;
      budgetFactor?: number;
      marketFactor?: number;
      increasePerformanceDiff?: boolean;
    },
  ): Promise<unknown>;
}

/** Roles allowed to write rules. */
const WRITE_ROLES = new Set(['PLATFORM_ADMIN', 'ADMIN', 'HR_MANAGER']);

/**
 * Create rule management tools bound to a tenant, user, and role.
 */
export function createRuleManagementTools(
  tenantId: string,
  db: RuleManagementDbAdapter,
  userId?: string,
  userRole?: string,
): StructuredToolInterface[] {
  /* ─── helper: check write access ─────────────── */
  function checkWrite(): { error: string } | null {
    if (!userId) return { error: 'User ID required for rule management actions' };
    if (!userRole || !WRITE_ROLES.has(userRole)) {
      return {
        error: `Access denied: role "${userRole ?? 'unknown'}" cannot manage rules. Required: ADMIN or HR_MANAGER.`,
      };
    }
    return null;
  }

  /* ─── 1. Analyze rules (read-only) ───────────── */
  const analyzeRuleSet = createDomainTool({
    name: 'analyze_rule_set',
    description:
      'Fetch a rule set with all its rules so you can explain them in plain English. ' +
      'Returns the full rule set including name, description, status, and every rule ' +
      'with its type, conditions, actions, and priority.',
    schema: z.object({
      ruleSetId: z.string().describe('The ID of the rule set to analyze'),
    }),
    func: async (input) => db.getRuleSet(tenantId, input.ruleSetId),
  });

  /* ─── 2. Compare rule sets ───────────────────── */
  const compareRuleSets = createDomainTool({
    name: 'compare_rule_sets',
    description:
      'Fetch two rule sets so you can compare them side-by-side. ' +
      'Returns both rule sets with all their rules. Use this to find differences ' +
      'between cycles (e.g. FY2025 vs FY2026 merit rules).',
    schema: z.object({
      ruleSetIdA: z.string().describe('First rule set ID'),
      ruleSetIdB: z.string().describe('Second rule set ID'),
    }),
    func: async (input) => {
      const [a, b] = await Promise.all([
        db.getRuleSet(tenantId, input.ruleSetIdA),
        db.getRuleSet(tenantId, input.ruleSetIdB),
      ]);
      return { ruleSetA: a, ruleSetB: b };
    },
  });

  /* ─── 3. Create rule set ─────────────────────── */
  const createRuleSet = createDomainTool({
    name: 'create_rule_set',
    description:
      'Create a new rule set with rules. Use this when the user asks to create a brand new ' +
      'set of compensation rules. Always confirm with the user before executing. ' +
      'Only ADMIN and HR_MANAGER roles can use this.',
    schema: z.object({
      name: z.string().describe('Name for the rule set (e.g. "FY2027 Merit Policy")'),
      description: z.string().optional().describe('Description of the rule set'),
      effectiveDate: z.string().optional().describe('Effective date in ISO format'),
    }),
    func: async (input) => {
      const err = checkWrite();
      if (err) return err;
      return db.createRuleSet(tenantId, input);
    },
  });

  /* ─── 4. Add rule to existing set ─────────────── */
  const addRule = createDomainTool({
    name: 'add_rule',
    description:
      'Add a single rule to an existing rule set. Use this when the user wants to add a ' +
      'new merit, bonus, eligibility, cap, or floor rule. Always confirm with the user first. ' +
      'Only ADMIN and HR_MANAGER roles can use this.',
    schema: z.object({
      ruleSetId: z.string().describe('The rule set to add the rule to'),
      name: z.string().describe('Rule name (e.g. "High performer merit increase")'),
      ruleType: z
        .enum(['MERIT', 'BONUS', 'LTI', 'PRORATION', 'CAP', 'FLOOR', 'ELIGIBILITY', 'CUSTOM'])
        .describe('Type of compensation rule'),
      priority: z.number().optional().describe('Priority order (lower = higher priority)'),
      conditions: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          'Array of condition objects, e.g. [{ "field": "performanceRating", "operator": "gte", "value": 4 }]',
        ),
      actions: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe(
          'Array of action objects, e.g. [{ "type": "setMerit", "params": { "percentage": 5 } }]',
        ),
      enabled: z.boolean().optional().default(true).describe('Whether the rule is active'),
    }),
    func: async (input) => {
      const err = checkWrite();
      if (err) return err;
      const { ruleSetId, ...ruleData } = input;
      return db.addRule(tenantId, ruleSetId, ruleData);
    },
  });

  /* ─── 5. Modify existing rule ────────────────── */
  const modifyRule = createDomainTool({
    name: 'modify_rule',
    description:
      'Update an existing rule in a rule set. Use this when the user wants to change ' +
      'conditions, actions, priority, or enable/disable a rule. Always confirm first. ' +
      'Only ADMIN and HR_MANAGER roles can use this.',
    schema: z.object({
      ruleSetId: z.string().describe('The rule set containing the rule'),
      ruleId: z.string().describe('The ID of the rule to modify'),
      name: z.string().optional().describe('New rule name'),
      ruleType: z
        .enum(['MERIT', 'BONUS', 'LTI', 'PRORATION', 'CAP', 'FLOOR', 'ELIGIBILITY', 'CUSTOM'])
        .optional()
        .describe('New rule type'),
      priority: z.number().optional().describe('New priority'),
      conditions: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe('New conditions array'),
      actions: z.array(z.record(z.string(), z.unknown())).optional().describe('New actions array'),
      enabled: z.boolean().optional().describe('Enable or disable the rule'),
    }),
    func: async (input) => {
      const err = checkWrite();
      if (err) return err;
      const { ruleSetId, ruleId, ...updates } = input;
      // Strip undefined values
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) data[k] = v;
      }
      return db.updateRule(tenantId, ruleSetId, ruleId, data);
    },
  });

  /* ─── 6. Delete rule ─────────────────────────── */
  const deleteRule = createDomainTool({
    name: 'delete_rule',
    description:
      'Delete a rule from a rule set. Always confirm with the user before executing. ' +
      'Only ADMIN and HR_MANAGER roles can use this.',
    schema: z.object({
      ruleSetId: z.string().describe('The rule set containing the rule'),
      ruleId: z.string().describe('The ID of the rule to delete'),
    }),
    func: async (input) => {
      const err = checkWrite();
      if (err) return err;
      return db.deleteRule(tenantId, input.ruleSetId, input.ruleId);
    },
  });

  /* ─── 7. Generate rules from source ──────────── */
  const generateRulesFromSource = createDomainTool({
    name: 'generate_rules_from_source',
    description:
      'Clone an existing rule set and apply adjustments for a new cycle. ' +
      'Scales merit/bonus percentages by budget factor, adjusts salary thresholds by market factor, ' +
      'and optionally widens performance differentiation. Always confirm first. ' +
      'Only ADMIN and HR_MANAGER roles can use this.',
    schema: z.object({
      sourceRuleSetId: z.string().describe('The source rule set to clone from'),
      newName: z.string().describe('Name for the new rule set'),
      newDescription: z.string().optional().describe('Description for the new rule set'),
      effectiveDate: z.string().optional().describe('Effective date in ISO format'),
      budgetFactor: z
        .number()
        .optional()
        .describe('Budget adjustment factor (e.g. 1.05 = 5% more budget)'),
      marketFactor: z
        .number()
        .optional()
        .describe('Market adjustment factor (e.g. 1.03 = 3% market increase)'),
      increasePerformanceDiff: z
        .boolean()
        .optional()
        .describe('Widen the spread between high and low performers'),
    }),
    func: async (input) => {
      const err = checkWrite();
      if (err) return err;
      return db.generateFromSource(tenantId, input);
    },
  });

  return [
    analyzeRuleSet,
    compareRuleSets,
    createRuleSet,
    addRule,
    modifyRule,
    deleteRule,
    generateRulesFromSource,
  ];
}
