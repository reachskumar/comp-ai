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
import {
  createRuleManagementTools,
  type RuleManagementDbAdapter,
} from './rule-management-tools.js';

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

  queryPerformanceAnalytics(
    tenantId: string,
    filters: {
      metric: string;
      department?: string;
      groupBy?: string;
    },
  ): Promise<unknown>;

  // ─── Optional Rule Management Adapter ──────────────────────
  /** If provided, rule management tools will be added to the copilot. */
  ruleManagement?: RuleManagementDbAdapter;

  // ─── Optional Mirror Adapter (universal Compport data access) ──
  /** If provided, three mirror introspection tools (list/describe/query)
   *  are added to the copilot, giving the agent access to EVERY table
   *  in the tenant's Compport system — not just the typed Prisma models. */
  mirrorAdapter?: MirrorDbAdapter;
}

/** Roles allowed to execute write actions through the copilot. */
const ACTION_ROLES = new Set(['PLATFORM_ADMIN', 'ADMIN', 'HR_MANAGER', 'MANAGER']);

/** Roles allowed to request letter generation. */
const LETTER_ROLES = new Set(['PLATFORM_ADMIN', 'ADMIN', 'HR_MANAGER']);

/**
 * Create all copilot domain tools bound to a specific tenant.
 *
 * @param tenantId - Tenant ID for multi-tenant isolation
 * @param db - Database adapter for domain queries and actions
 * @param userId - User ID for action tools (required for audit trail)
 * @param userRole - User's role for hard guardrails on action tools
 */
export function createCopilotTools(
  tenantId: string,
  db: CopilotDbAdapter,
  userId?: string,
  userRole?: string,
): StructuredToolInterface[] {
  const queryEmployees = createDomainTool({
    name: 'query_employees',
    description:
      'Search and filter employees by department, level, location, salary range, or manager. Returns employee records with name, department, level, location, salary, and manager details.',
    schema: z.object({
      department: z.string().optional().describe('Filter by department name'),
      level: z.string().optional().describe('Filter by job level'),
      location: z.string().optional().describe('Filter by office location'),
      minSalary: z.number().optional().describe('Minimum base salary'),
      maxSalary: z.number().optional().describe('Maximum base salary'),
      search: z.string().optional().describe('Search by name or employee code'),
      managerId: z.string().optional().describe('Filter by manager ID to find direct reports'),
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

  const queryPerformanceAnalytics = createDomainTool({
    name: 'query_performance_analytics',
    description:
      'Get performance analytics data for visualization. Returns structured chart-ready data for performance rating distribution, average rating by department/level, performance vs salary correlation, and rating trends. Use this when the user asks about performance data, ratings, or wants to see performance charts.',
    schema: z.object({
      metric: z
        .string()
        .describe(
          'The performance metric to compute: "rating_distribution" (count of employees per rating), "avg_rating_by_department" (average performance rating grouped by department), "avg_rating_by_level" (average rating grouped by level), "performance_vs_salary" (scatter data: rating vs base salary), "rating_summary" (overall stats: avg, min, max, count)',
        ),
      department: z.string().optional().describe('Filter to a specific department'),
      groupBy: z
        .string()
        .optional()
        .describe('Additional grouping: "department", "level", "location"'),
    }),
    func: async (input) => db.queryPerformanceAnalytics(tenantId, input),
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
      if (!userRole || !ACTION_ROLES.has(userRole)) {
        return {
          error: `Access denied: role "${userRole ?? 'unknown'}" cannot approve recommendations. Required: ADMIN, HR_MANAGER, or MANAGER.`,
        };
      }
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
      if (!userRole || !ACTION_ROLES.has(userRole)) {
        return {
          error: `Access denied: role "${userRole ?? 'unknown'}" cannot reject recommendations. Required: ADMIN, HR_MANAGER, or MANAGER.`,
        };
      }
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
      if (!userRole || !LETTER_ROLES.has(userRole)) {
        return {
          error: `Access denied: role "${userRole ?? 'unknown'}" cannot generate letters. Required: ADMIN or HR_MANAGER.`,
        };
      }
      return db.requestLetter(tenantId, userId, input);
    },
  });

  const tools: StructuredToolInterface[] = [
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
    queryPerformanceAnalytics,
    approveRecommendation,
    rejectRecommendation,
    requestLetter,
  ];

  // Optionally add rule management tools (Task 4: Copilot Rule Management)
  if (db.ruleManagement) {
    const ruleTools = createRuleManagementTools(tenantId, db.ruleManagement, userId, userRole);
    tools.push(...ruleTools);
  }

  // Mirror introspection tools — let the agent query ANY Compport table
  // that has been mirrored via the universal sync pipeline (Stage 2).
  // These are always available; if no mirror exists yet, they return
  // empty results with a "mirror not yet configured" message.
  if (db.mirrorAdapter) {
    tools.push(...createMirrorTools(tenantId, db.mirrorAdapter));
  }

  return tools;
}

// ─── Mirror Adapter Interface ────────────────────────────────────

export interface MirrorDbAdapter {
  /** List all mirrored tables for this tenant with row counts and column metadata. */
  listMirrorTables(
    tenantId: string,
  ): Promise<
    Array<{
      tableName: string;
      rowCount: number;
      columnCount: number;
      columns: string[];
      lastSyncAt: string | null;
      status: string;
    }>
  >;

  /** Describe a specific mirror table — full column details + sample row. */
  describeMirrorTable(
    tenantId: string,
    tableName: string,
  ): Promise<{
    tableName: string;
    columns: Array<{ name: string; dataType: string; nullable: boolean }>;
    rowCount: number;
    sampleRow: Record<string, unknown> | null;
    primaryKey: string[];
  } | null>;

  /** Query a mirror table with optional filtering. Returns up to `limit` rows. */
  queryMirrorTable(
    tenantId: string,
    tableName: string,
    filters?: {
      where?: Record<string, unknown>;
      orderBy?: string;
      orderDir?: 'ASC' | 'DESC';
      limit?: number;
      columns?: string[];
    },
  ): Promise<unknown[]>;
}

function createMirrorTools(
  tenantId: string,
  adapter: MirrorDbAdapter,
): StructuredToolInterface[] {
  const listTables = createDomainTool({
    name: 'list_compport_tables',
    description:
      'List ALL data tables available from the Compport system for this tenant. ' +
      'Returns table names, row counts, column names, and sync status. ' +
      'Use this FIRST to discover what data is available before querying specific tables. ' +
      'Covers compensation, performance, bonuses, LTI, CTI, grades, bands, history, audit logs — everything.',
    schema: z.object({}),
    func: async () => adapter.listMirrorTables(tenantId),
  });

  const describeTable = createDomainTool({
    name: 'describe_compport_table',
    description:
      'Get detailed metadata for a specific Compport table: all columns (name + type), ' +
      'a sample row showing real values, primary key, and row count. ' +
      'Call list_compport_tables first to find the table name, then use this to understand its structure.',
    schema: z.object({
      tableName: z.string().describe('The Compport table name (e.g. salary_details, performance_ratings, bonus_details)'),
    }),
    func: async (input) => adapter.describeMirrorTable(tenantId, input.tableName),
  });

  const queryTable = createDomainTool({
    name: 'query_compport_table',
    description:
      'Query any Compport data table by name with optional filters. ' +
      'Use describe_compport_table first to understand the column names and types, ' +
      'then use this tool to retrieve actual data. ' +
      'Supports filtering by column values, ordering, column selection, and row limits. ' +
      'Covers salary, bonus, performance, history, modules, rules, audit — any table the tenant has.',
    schema: z.object({
      tableName: z.string().describe('The Compport table name to query'),
      where: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Filter conditions as { columnName: value } pairs. Exact match only.'),
      columns: z
        .array(z.string())
        .optional()
        .describe('Specific columns to return (default: all)'),
      orderBy: z.string().optional().describe('Column to sort by'),
      orderDir: z
        .enum(['ASC', 'DESC'])
        .optional()
        .default('ASC')
        .describe('Sort direction'),
      limit: z
        .number()
        .optional()
        .default(50)
        .describe('Max rows to return (default 50, max 200)'),
    }),
    func: async (input) =>
      adapter.queryMirrorTable(tenantId, input.tableName, {
        where: input.where,
        columns: input.columns,
        orderBy: input.orderBy,
        orderDir: input.orderDir,
        limit: Math.min(input.limit ?? 50, 200),
      }),
  });

  return [listTables, describeTable, queryTable];
}
