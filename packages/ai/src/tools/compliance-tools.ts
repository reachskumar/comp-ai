/**
 * Compliance scanner tools — LangGraph tools for the compliance scanner graph.
 * These tools query tenant data to check for compliance issues.
 */

import { z } from 'zod';
import { createDomainTool } from '../tools.js';
import type { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * Database adapter interface for compliance scanning.
 * Implemented by the NestJS service that provides data access.
 */
export interface ComplianceDbAdapter {
  getAllRules(tenantId: string): Promise<unknown[]>;
  getRecentDecisions(tenantId: string, limit?: number): Promise<unknown[]>;
  getCompDataStats(tenantId: string): Promise<unknown>;
  getBenefitsConfigs(tenantId: string): Promise<unknown[]>;
  getRegulatoryRequirements(tenantId: string): Promise<unknown>;
}

export function createComplianceTools(
  tenantId: string,
  db: ComplianceDbAdapter,
): DynamicStructuredTool[] {
  const getAllRules = createDomainTool({
    name: 'get_all_rules',
    description:
      'Get all compensation rules for the tenant. Returns rule sets with their rules, conditions, and actions. Use this to check for policy violations, missing rules, and compliance gaps.',
    schema: z.object({
      status: z.string().optional().describe('Filter by status: DRAFT, ACTIVE, ARCHIVED'),
    }),
    func: async () => db.getAllRules(tenantId),
  });

  const getRecentDecisions = createDomainTool({
    name: 'get_recent_decisions',
    description:
      'Get recent compensation decisions (recommendations, approvals). Use this to check for pay equity issues, FLSA violations, and decision pattern anomalies.',
    schema: z.object({
      limit: z.number().optional().describe('Max number of decisions to return (default 100)'),
    }),
    func: async ({ limit }) => db.getRecentDecisions(tenantId, limit),
  });

  const getCompDataStats = createDomainTool({
    name: 'get_comp_data_stats',
    description:
      'Get aggregate compensation statistics: salary distributions by department/level/gender, pay ranges, compa-ratios. Use this for pay equity analysis and FLSA classification checks.',
    schema: z.object({}),
    func: async () => db.getCompDataStats(tenantId),
  });

  const getBenefitsConfigs = createDomainTool({
    name: 'get_benefits_configs',
    description:
      'Get benefits plan configurations and enrollment data. Use this to check for benefits eligibility errors, missing enrollments, and compliance with benefits regulations.',
    schema: z.object({}),
    func: async () => db.getBenefitsConfigs(tenantId),
  });

  const getRegulatoryRequirements = createDomainTool({
    name: 'get_regulatory_requirements',
    description:
      'Get regulatory requirements and compliance targets for the tenant. Includes FLSA thresholds, state-specific rules, and industry regulations.',
    schema: z.object({}),
    func: async () => db.getRegulatoryRequirements(tenantId),
  });

  return [
    getAllRules,
    getRecentDecisions,
    getCompDataStats,
    getBenefitsConfigs,
    getRegulatoryRequirements,
  ];
}

