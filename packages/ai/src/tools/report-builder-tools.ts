/**
 * Report Builder domain tools — LangGraph tools for the Natural Language Report Builder.
 *
 * SECURITY: All queries are read-only, parameterized via Prisma, and tenant-scoped.
 * No raw SQL is ever executed. Only predefined query patterns against known models.
 */

import { z } from 'zod';
import { createDomainTool } from '../tools.js';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * Database adapter interface for report builder tools.
 * Decouples tools from Prisma so the AI package stays DB-agnostic.
 */
export interface ReportBuilderDbAdapter {
  /** Execute a predefined, read-only query pattern */
  executeReportQuery(tenantId: string, params: {
    model: string;
    groupBy?: string;
    aggregation?: string;
    filters?: Record<string, unknown>;
    orderBy?: string;
    orderDir?: string;
    limit?: number;
  }): Promise<unknown>;

  /** Get aggregated data for a specific metric */
  aggregateReportData(tenantId: string, params: {
    model: string;
    metric: string;
    groupBy?: string;
    filters?: Record<string, unknown>;
  }): Promise<unknown>;

  /** Get available schema info (models, fields) for query building */
  getSchemaInfo(): Promise<{
    models: Array<{
      name: string;
      description: string;
      fields: Array<{ name: string; type: string; description: string }>;
    }>;
  }>;
}

/**
 * Create all report builder tools bound to a specific tenant.
 */
export function createReportBuilderTools(
  tenantId: string,
  db: ReportBuilderDbAdapter,
): StructuredToolInterface[] {
  const executeQuery = createDomainTool({
    name: 'execute_prisma_query',
    description: 'Execute a safe, read-only, tenant-scoped query against the database. Only predefined models are allowed: Employee, CompRecommendation, CompCycle, PayrollRun, RuleSet, BenefitPlan, BenefitEnrollment. Returns structured data.',
    schema: z.object({
      model: z.enum([
        'Employee', 'CompRecommendation', 'CompCycle',
        'PayrollRun', 'RuleSet', 'BenefitPlan', 'BenefitEnrollment',
      ]).describe('The database model to query'),
      groupBy: z.string().optional().describe('Field to group results by (e.g. "department", "level")'),
      aggregation: z.enum(['count', 'avg', 'sum', 'min', 'max']).optional().describe('Aggregation function'),
      filters: z.record(z.string(), z.unknown()).optional().describe('Filter conditions as key-value pairs'),
      orderBy: z.string().optional().describe('Field to order by'),
      orderDir: z.enum(['asc', 'desc']).optional().default('desc').describe('Order direction'),
      limit: z.number().optional().default(100).describe('Max results to return'),
    }),
    func: async (input) => db.executeReportQuery(tenantId, input),
  });

  const aggregateData = createDomainTool({
    name: 'aggregate_data',
    description: 'Get aggregated statistics for a specific metric. Supports avg_salary, headcount, total_comp, salary_range, comp_ratio, benefit_enrollment grouped by department, level, or location.',
    schema: z.object({
      model: z.enum([
        'Employee', 'CompRecommendation', 'CompCycle',
        'PayrollRun', 'BenefitEnrollment',
      ]).describe('The model to aggregate'),
      metric: z.enum([
        'avg_salary', 'headcount', 'total_comp', 'salary_range',
        'comp_ratio', 'benefit_enrollment', 'payroll_total',
      ]).describe('The metric to compute'),
      groupBy: z.string().optional().describe('Group by field (department, level, location)'),
      filters: z.record(z.string(), z.unknown()).optional().describe('Additional filters'),
    }),
    func: async (input) => db.aggregateReportData(tenantId, input),
  });

  const getSchemaInfo = createDomainTool({
    name: 'get_schema_info',
    description: 'Get information about available database models and their fields. Use this to understand what data is available for building reports.',
    schema: z.object({}),
    func: async () => db.getSchemaInfo(),
  });

  return [executeQuery, aggregateData, getSchemaInfo] as StructuredToolInterface[];
}

