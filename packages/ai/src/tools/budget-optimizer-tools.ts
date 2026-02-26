/**
 * Budget Optimizer domain tools — LangGraph tools for AI budget optimization.
 *
 * Each tool receives a tenantId injected at graph construction time
 * to enforce multi-tenant isolation.
 */

import { z } from 'zod';
import { createDomainTool } from '../tools.js';
import type { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * Database adapter for budget optimizer queries — injected at tool creation time.
 */
export interface BudgetOptimizerDbAdapter {
  getDepartmentStats(tenantId: string, cycleId: string): Promise<unknown[]>;

  getAttritionRiskByDepartment(tenantId: string): Promise<unknown[]>;

  getEquityGapsByDepartment(tenantId: string): Promise<unknown[]>;

  getCurrentBudgetAllocations(tenantId: string, cycleId: string): Promise<unknown[]>;

  getHistoricalUtilization(tenantId: string): Promise<unknown[]>;
}

/**
 * Create all budget optimizer domain tools bound to a specific tenant and cycle.
 */
export function createBudgetOptimizerTools(
  tenantId: string,
  cycleId: string,
  db: BudgetOptimizerDbAdapter,
): DynamicStructuredTool[] {
  const getDepartmentStats = createDomainTool({
    name: 'get_department_stats',
    description:
      'Get department-level statistics including headcount, average salary, and average compa-ratio for budget optimization.',
    schema: z.object({
      cycleId: z.string().optional().describe('Cycle ID (defaults to current cycle)'),
    }),
    func: async (input) => db.getDepartmentStats(tenantId, input.cycleId ?? cycleId),
  });

  const getAttritionRisk = createDomainTool({
    name: 'get_attrition_risk_by_department',
    description:
      'Get attrition risk distribution by department. Returns counts of LOW, MEDIUM, HIGH, and CRITICAL risk employees per department.',
    schema: z.object({}),
    func: async () => db.getAttritionRiskByDepartment(tenantId),
  });

  const getEquityGaps = createDomainTool({
    name: 'get_equity_gaps_by_department',
    description:
      'Get pay equity gaps by department. Returns compa-ratio gaps, gender pay gaps, and employees below band midpoint per department.',
    schema: z.object({}),
    func: async () => db.getEquityGapsByDepartment(tenantId),
  });

  const getCurrentAllocations = createDomainTool({
    name: 'get_current_budget_allocations',
    description:
      'Get current budget allocations per department for the cycle. Returns department name, allocated amount, and committed amount.',
    schema: z.object({
      cycleId: z.string().optional().describe('Cycle ID (defaults to current cycle)'),
    }),
    func: async (input) => db.getCurrentBudgetAllocations(tenantId, input.cycleId ?? cycleId),
  });

  const getHistoricalUtilization = createDomainTool({
    name: 'get_historical_utilization',
    description:
      'Get historical budget utilization data from past cycles. Returns per-department utilization rates to inform future allocations.',
    schema: z.object({}),
    func: async () => db.getHistoricalUtilization(tenantId),
  });

  return [
    getDepartmentStats,
    getAttritionRisk,
    getEquityGaps,
    getCurrentAllocations,
    getHistoricalUtilization,
  ] as DynamicStructuredTool[];
}
