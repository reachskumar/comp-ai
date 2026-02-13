/**
 * Simulation domain tools — LangGraph tools for the Compensation Simulation AI.
 *
 * Each tool receives a tenantId injected at graph construction time
 * to enforce multi-tenant isolation.
 */

import { z } from 'zod';
import { createDomainTool } from '../tools.js';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * Database adapter for simulation queries — injected at tool creation time.
 */
export interface SimulationDbAdapter {
  queryEmployeesForScenario(tenantId: string, filters: {
    department?: string;
    level?: string;
    location?: string;
    minSalary?: number;
    maxSalary?: number;
    performanceRating?: number;
    limit?: number;
  }): Promise<unknown[]>;

  runRulesSimulation(tenantId: string, params: {
    ruleSetId?: string;
    adjustmentType: string;
    adjustmentValue: number;
    employeeIds?: string[];
    department?: string;
    level?: string;
  }): Promise<unknown>;

  calculateBudgetImpact(tenantId: string, params: {
    totalCostDelta: number;
    affectedCount: number;
    department?: string;
  }): Promise<unknown>;

  getMarketData(tenantId: string, params: {
    department?: string;
    level?: string;
    location?: string;
  }): Promise<unknown>;
}

/**
 * Create all simulation domain tools bound to a specific tenant.
 */
export function createSimulationTools(
  tenantId: string,
  db: SimulationDbAdapter,
): StructuredToolInterface[] {
  const queryEmployeesForScenario = createDomainTool({
    name: 'query_employees_for_scenario',
    description: 'Search and filter employees for a simulation scenario. Returns employee records with salary, department, level, and performance data.',
    schema: z.object({
      department: z.string().optional().describe('Filter by department name (e.g. "Engineering", "Sales")'),
      level: z.string().optional().describe('Filter by job level (e.g. "Senior", "Junior")'),
      location: z.string().optional().describe('Filter by office location'),
      minSalary: z.number().optional().describe('Minimum base salary filter'),
      maxSalary: z.number().optional().describe('Maximum base salary filter'),
      performanceRating: z.number().optional().describe('Minimum performance rating filter'),
      limit: z.number().optional().default(500).describe('Max employees to return'),
    }),
    func: async (input) => db.queryEmployeesForScenario(tenantId, input),
  });

  const runRulesSimulation = createDomainTool({
    name: 'run_rules_simulation',
    description: 'Run a compensation rules simulation against a population. Applies merit/bonus/LTI adjustments and returns per-employee results with before/after amounts.',
    schema: z.object({
      ruleSetId: z.string().optional().describe('Existing rule set ID to simulate against'),
      adjustmentType: z.string().describe('Type of adjustment: "merit_percent", "bonus_percent", "bonus_flat", "lti_percent", "salary_cap"'),
      adjustmentValue: z.number().describe('The adjustment value (e.g. 5 for 5% merit, 20000 for $20k cap)'),
      employeeIds: z.array(z.string()).optional().describe('Specific employee IDs to simulate (if not using filters)'),
      department: z.string().optional().describe('Filter simulation to a department'),
      level: z.string().optional().describe('Filter simulation to a job level'),
    }),
    func: async (input) => db.runRulesSimulation(tenantId, input),
  });

  const calculateBudgetImpact = createDomainTool({
    name: 'calculate_budget_impact',
    description: 'Calculate the budget impact of a simulation scenario. Returns total cost delta, budget utilization percentage, and per-department breakdown.',
    schema: z.object({
      totalCostDelta: z.number().describe('Total additional cost from the simulation'),
      affectedCount: z.number().describe('Number of affected employees'),
      department: z.string().optional().describe('Department to scope the budget calculation'),
    }),
    func: async (input) => db.calculateBudgetImpact(tenantId, input),
  });

  const getMarketData = createDomainTool({
    name: 'get_market_data',
    description: 'Get market compensation benchmarks for comparison. Returns percentile data (P25, P50, P75, P90) for the specified role/department/location.',
    schema: z.object({
      department: z.string().optional().describe('Department for market comparison'),
      level: z.string().optional().describe('Job level for market comparison'),
      location: z.string().optional().describe('Location for market comparison'),
    }),
    func: async (input) => db.getMarketData(tenantId, input),
  });

  return [
    queryEmployeesForScenario,
    runRulesSimulation,
    calculateBudgetImpact,
    getMarketData,
  ] as StructuredToolInterface[];
}

