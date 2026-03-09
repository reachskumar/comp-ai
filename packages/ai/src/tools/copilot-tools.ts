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
  queryEmployees(
    tenantId: string,
    filters: {
      department?: string;
      level?: string;
      location?: string;
      minSalary?: number;
      maxSalary?: number;
      search?: string;
      managerId?: string;
      limit?: number;
    },
  ): Promise<unknown[]>;

  queryCompensation(
    tenantId: string,
    filters: {
      employeeId?: string;
      department?: string;
      component?: string;
      limit?: number;
    },
  ): Promise<unknown[]>;

  queryRules(
    tenantId: string,
    filters: {
      status?: string;
      ruleType?: string;
      search?: string;
      limit?: number;
    },
  ): Promise<unknown[]>;

  queryCycles(
    tenantId: string,
    filters: {
      status?: string;
      cycleType?: string;
      limit?: number;
    },
  ): Promise<unknown[]>;

  queryPayroll(
    tenantId: string,
    filters: {
      status?: string;
      period?: string;
      limit?: number;
    },
  ): Promise<unknown[]>;

  queryAnalytics(
    tenantId: string,
    filters: {
      metric: string;
      groupBy?: string;
      department?: string;
    },
  ): Promise<unknown>;

  queryBenefits(
    tenantId: string,
    filters: {
      employeeId?: string;
      planType?: string;
      status?: string;
      limit?: number;
    },
  ): Promise<unknown[]>;

  queryEquity(
    tenantId: string,
    filters: {
      employeeId?: string;
      status?: string;
      grantType?: string;
      limit?: number;
    },
  ): Promise<unknown[]>;

  querySalaryBands(
    tenantId: string,
    filters: {
      jobFamily?: string;
      level?: string;
      location?: string;
      limit?: number;
    },
  ): Promise<unknown[]>;

  queryNotifications(
    tenantId: string,
    filters: {
      userId: string;
      unreadOnly?: boolean;
      limit?: number;
    },
  ): Promise<unknown[]>;

  queryTeam(
    tenantId: string,
    filters: {
      managerId: string;
      includeIndirect?: boolean;
      limit?: number;
    },
  ): Promise<unknown[]>;

  // ─── Action Methods ────────────────────────────────────────

  approveRecommendation(
    tenantId: string,
    userId: string,
    params: {
      recommendationId: string;
      comment?: string;
    },
  ): Promise<unknown>;

  rejectRecommendation(
    tenantId: string,
    userId: string,
    params: {
      recommendationId: string;
      reason: string;
    },
  ): Promise<unknown>;

  requestLetter(
    tenantId: string,
    userId: string,
    params: {
      employeeId: string;
      letterType: string;
      salaryIncreasePercent?: number;
      bonusAmount?: number;
      effectiveDate?: string;
    },
  ): Promise<unknown>;
}

/**
 * Create all copilot domain tools bound to a specific tenant.
 *
 * @param tenantId - Tenant ID for multi-tenant isolation
 * @param db - Database adapter for domain queries and actions
 * @param userId - User ID for action tools (required for audit trail)
 */
export function createCopilotTools(
  tenantId: string,
  db: CopilotDbAdapter,
  userId?: string,
): StructuredToolInterface[] {
  const queryEmployees = createDomainTool({
    name: 'query_employees',
    description:
      'Search and filter employees by department, level, location, or salary range. Returns employee records with name, department, level, location, and salary.',
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
    description:
      'Get compensation data (salary, bonus, LTI) for specific employees or groups. Returns compensation components and amounts.',
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
    description:
      'Look up active compensation rule sets and their conditions. Returns rule set names, types, status, and rule details.',
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
    description:
      'Get compensation cycle status, budgets, and recommendations. Returns cycle details including budget allocation and spend.',
    schema: z.object({
      status: z
        .string()
        .optional()
        .describe('Filter by cycle status (DRAFT, ACTIVE, COMPLETED, etc.)'),
      cycleType: z.string().optional().describe('Filter by type (MERIT, BONUS, LTI, COMBINED)'),
      limit: z.number().optional().default(10).describe('Max results to return'),
    }),
    func: async (input) => db.queryCycles(tenantId, input),
  });

  const queryPayroll = createDomainTool({
    name: 'query_payroll',
    description:
      'Get payroll run data including anomalies and reconciliation status. Returns payroll runs with totals and anomaly counts.',
    schema: z.object({
      status: z
        .string()
        .optional()
        .describe('Filter by status (DRAFT, PROCESSING, REVIEW, APPROVED, FINALIZED)'),
      period: z.string().optional().describe('Filter by payroll period (e.g. "2024-01")'),
      limit: z.number().optional().default(10).describe('Max results to return'),
    }),
    func: async (input) => db.queryPayroll(tenantId, input),
  });

  const queryAnalytics = createDomainTool({
    name: 'query_analytics',
    description:
      'Get aggregate compensation statistics like average salary by department, headcount, total comp spend, salary distribution, etc.',
    schema: z.object({
      metric: z
        .string()
        .describe(
          'The metric to compute: "avg_salary", "headcount", "total_comp", "salary_range", "comp_ratio"',
        ),
      groupBy: z
        .string()
        .optional()
        .describe('Group results by: "department", "level", "location"'),
      department: z.string().optional().describe('Filter to a specific department'),
    }),
    func: async (input) => db.queryAnalytics(tenantId, input),
  });

  const queryBenefits = createDomainTool({
    name: 'query_benefits',
    description:
      'Get benefit plan information and employee enrollments (medical, dental, vision, life, disability). Returns plan details, premiums, and enrollment status.',
    schema: z.object({
      employeeId: z.string().optional().describe('Filter by specific employee'),
      planType: z
        .string()
        .optional()
        .describe('Filter by plan type: MEDICAL, DENTAL, VISION, LIFE, DISABILITY'),
      status: z
        .string()
        .optional()
        .describe('Filter by enrollment status: ACTIVE, PENDING, TERMINATED, WAIVED'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    }),
    func: async (input) => db.queryBenefits(tenantId, input),
  });

  const queryEquity = createDomainTool({
    name: 'query_equity',
    description:
      'Get equity grant information including stock options, RSUs, vesting schedules, and current values. Returns grant details with vested/unvested shares.',
    schema: z.object({
      employeeId: z.string().optional().describe('Filter by specific employee'),
      status: z
        .string()
        .optional()
        .describe(
          'Filter by grant status: PENDING, ACTIVE, FULLY_VESTED, EXERCISED, EXPIRED, CANCELLED',
        ),
      grantType: z
        .string()
        .optional()
        .describe('Filter by type: RSU, STOCK_OPTION, PERFORMANCE_SHARE, PHANTOM_STOCK, SAR'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    }),
    func: async (input) => db.queryEquity(tenantId, input),
  });

  const querySalaryBands = createDomainTool({
    name: 'query_salary_bands',
    description:
      'Get salary band/range data by job family, level, and location. Returns p10, p25, p50 (midpoint), p75, p90 percentile values for market benchmarking.',
    schema: z.object({
      jobFamily: z
        .string()
        .optional()
        .describe('Filter by job family (e.g., Engineering, Sales, Marketing)'),
      level: z.string().optional().describe('Filter by job level (e.g., IC1, IC2, IC3, M1, M2)'),
      location: z.string().optional().describe('Filter by location'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    }),
    func: async (input) => db.querySalaryBands(tenantId, input),
  });

  const queryNotifications = createDomainTool({
    name: 'query_notifications',
    description:
      'Get recent notifications and alerts for the current user. Returns notification title, body, read status, and creation time.',
    schema: z.object({
      userId: z.string().describe('The user ID to get notifications for'),
      unreadOnly: z
        .boolean()
        .optional()
        .default(false)
        .describe('Only return unread notifications'),
      limit: z.number().optional().default(10).describe('Max results to return'),
    }),
    func: async (input) => db.queryNotifications(tenantId, input),
  });

  const queryTeam = createDomainTool({
    name: 'query_team',
    description:
      'Get direct reports for a manager. Returns team member details including name, department, level, salary, and performance rating.',
    schema: z.object({
      managerId: z.string().describe('The manager employee ID to get direct reports for'),
      includeIndirect: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include indirect reports (reports of reports)'),
      limit: z.number().optional().default(50).describe('Max results to return'),
    }),
    func: async (input) => db.queryTeam(tenantId, input),
  });

  // ─── Action Tools (require userId) ────────────────────────

  const approveRecommendation = createDomainTool({
    name: 'approve_recommendation',
    description:
      'Approve a compensation recommendation. Only ADMIN, HR_MANAGER, or MANAGER roles can use this. Always confirm with the user before executing.',
    schema: z.object({
      recommendationId: z.string().describe('The ID of the recommendation to approve'),
      comment: z.string().optional().describe('Optional approval comment'),
    }),
    func: async (input) => {
      if (!userId) return { error: 'User ID required for actions' };
      return db.approveRecommendation(tenantId, userId, input);
    },
  });

  const rejectRecommendation = createDomainTool({
    name: 'reject_recommendation',
    description:
      'Reject a compensation recommendation with a reason. Only ADMIN, HR_MANAGER, or MANAGER roles can use this. Always confirm with the user before executing.',
    schema: z.object({
      recommendationId: z.string().describe('The ID of the recommendation to reject'),
      reason: z.string().describe('Reason for rejection'),
    }),
    func: async (input) => {
      if (!userId) return { error: 'User ID required for actions' };
      return db.rejectRecommendation(tenantId, userId, input);
    },
  });

  const requestLetter = createDomainTool({
    name: 'request_letter',
    description:
      'Generate a compensation letter for an employee. Only ADMIN and HR_MANAGER roles can use this. Letter types: OFFER, RAISE, PROMOTION, BONUS, TOTAL_COMP_SUMMARY.',
    schema: z.object({
      employeeId: z.string().describe('The employee ID to generate the letter for'),
      letterType: z
        .string()
        .describe('Letter type: OFFER, RAISE, PROMOTION, BONUS, TOTAL_COMP_SUMMARY'),
      salaryIncreasePercent: z
        .number()
        .optional()
        .describe('Salary increase percentage (for RAISE/PROMOTION)'),
      bonusAmount: z.number().optional().describe('Bonus amount (for BONUS)'),
      effectiveDate: z.string().optional().describe('Effective date (ISO format)'),
    }),
    func: async (input) => {
      if (!userId) return { error: 'User ID required for actions' };
      return db.requestLetter(tenantId, userId, input);
    },
  });

  return [
    queryEmployees,
    queryCompensation,
    queryRules,
    queryCycles,
    queryPayroll,
    queryAnalytics,
    queryBenefits,
    queryEquity,
    querySalaryBands,
    queryNotifications,
    queryTeam,
    approveRecommendation,
    rejectRecommendation,
    requestLetter,
  ] as StructuredToolInterface[];
}
