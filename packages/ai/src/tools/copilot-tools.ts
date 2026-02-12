/**
 * Copilot domain query tools — LangGraph tools that query the database
 * for the AI Compensation Copilot chat feature.
 *
 * Each tool receives a tenantId injected at graph construction time
 * to enforce multi-tenant isolation.
 */

import { z } from 'zod';
import { createDomainTool } from '../tools.js';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * Database query interface — injected at tool creation time.
 * This decouples the tools from Prisma so the AI package stays DB-agnostic.
 */
export interface CopilotDbAdapter {
  queryEmployees(tenantId: string, filters: {
    department?: string;
    level?: string;
    location?: string;
    minSalary?: number;
    maxSalary?: number;
    search?: string;
    limit?: number;
  }): Promise<unknown[]>;

  queryCompensation(tenantId: string, filters: {
    employeeId?: string;
    department?: string;
    component?: string;
    limit?: number;
  }): Promise<unknown[]>;

  queryRules(tenantId: string, filters: {
    status?: string;
    ruleType?: string;
    search?: string;
    limit?: number;
  }): Promise<unknown[]>;

  queryCycles(tenantId: string, filters: {
    status?: string;
    cycleType?: string;
    limit?: number;
  }): Promise<unknown[]>;

  queryPayroll(tenantId: string, filters: {
    status?: string;
    period?: string;
    limit?: number;
  }): Promise<unknown[]>;

  queryAnalytics(tenantId: string, filters: {
    metric: string;
    groupBy?: string;
    department?: string;
  }): Promise<unknown>;
}

/**
 * Create all copilot domain tools bound to a specific tenant.
 */
export function createCopilotTools(
  tenantId: string,
  db: CopilotDbAdapter,
): StructuredToolInterface[] {
  const queryEmployees = createDomainTool({
    name: 'query_employees',
    description: 'Search and filter employees by department, level, location, or salary range. Returns employee records with name, department, level, location, and salary.',
    schema: z.object({
      department: z.string().optional().describe('Filter by department name'),
      level: z.string().optional().describe('Filter by job level'),
      location: z.string().optional().describe('Filter by office location'),
      minSalary: z.number().optional().describe('Minimum base salary'),
      maxSalary: z.number().optional().describe('Maximum base salary'),
      search: z.string().optional().describe('Search by name or employee code'),
      limit: z.number().optional().default(50).describe('Max results to return'),
    }),
    func: async (input) => db.queryEmployees(tenantId, input),
  });

  const queryCompensation = createDomainTool({
    name: 'query_compensation',
    description: 'Get compensation data (salary, bonus, LTI) for specific employees or groups. Returns compensation components and amounts.',
    schema: z.object({
      employeeId: z.string().optional().describe('Specific employee ID'),
      department: z.string().optional().describe('Filter by department'),
      component: z.string().optional().describe('Filter by comp component (salary, bonus, lti)'),
      limit: z.number().optional().default(50).describe('Max results to return'),
    }),
    func: async (input) => db.queryCompensation(tenantId, input),
  });

  const queryRules = createDomainTool({
    name: 'query_rules',
    description: 'Look up active compensation rule sets and their conditions. Returns rule set names, types, status, and rule details.',
    schema: z.object({
      status: z.string().optional().describe('Filter by status (DRAFT, ACTIVE, ARCHIVED)'),
      ruleType: z.string().optional().describe('Filter by rule type (MERIT, BONUS, LTI, etc.)'),
      search: z.string().optional().describe('Search by rule set name'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    }),
    func: async (input) => db.queryRules(tenantId, input),
  });

  const queryCycles = createDomainTool({
    name: 'query_cycles',
    description: 'Get compensation cycle status, budgets, and recommendations. Returns cycle details including budget allocation and spend.',
    schema: z.object({
      status: z.string().optional().describe('Filter by cycle status (DRAFT, ACTIVE, COMPLETED, etc.)'),
      cycleType: z.string().optional().describe('Filter by type (MERIT, BONUS, LTI, COMBINED)'),
      limit: z.number().optional().default(10).describe('Max results to return'),
    }),
    func: async (input) => db.queryCycles(tenantId, input),
  });

  const queryPayroll = createDomainTool({
    name: 'query_payroll',
    description: 'Get payroll run data including anomalies and reconciliation status. Returns payroll runs with totals and anomaly counts.',
    schema: z.object({
      status: z.string().optional().describe('Filter by status (DRAFT, PROCESSING, REVIEW, APPROVED, FINALIZED)'),
      period: z.string().optional().describe('Filter by payroll period (e.g. "2024-01")'),
      limit: z.number().optional().default(10).describe('Max results to return'),
    }),
    func: async (input) => db.queryPayroll(tenantId, input),
  });

  const queryAnalytics = createDomainTool({
    name: 'query_analytics',
    description: 'Get aggregate compensation statistics like average salary by department, headcount, total comp spend, salary distribution, etc.',
    schema: z.object({
      metric: z.string().describe('The metric to compute: "avg_salary", "headcount", "total_comp", "salary_range", "comp_ratio"'),
      groupBy: z.string().optional().describe('Group results by: "department", "level", "location"'),
      department: z.string().optional().describe('Filter to a specific department'),
    }),
    func: async (input) => db.queryAnalytics(tenantId, input),
  });

  return [queryEmployees, queryCompensation, queryRules, queryCycles, queryPayroll, queryAnalytics] as StructuredToolInterface[];
}

