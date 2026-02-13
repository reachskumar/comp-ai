/**
 * Data Quality domain tools — LangGraph tools for the AI Data Quality Agent.
 *
 * Each tool receives a tenantId injected at graph construction time
 * to enforce multi-tenant isolation.
 */

import { z } from 'zod';
import { createDomainTool } from '../tools.js';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * Database adapter for data quality tools.
 * Decouples tools from Prisma so the AI package stays DB-agnostic.
 */
export interface DataQualityDbAdapter {
  getImportIssues(tenantId: string, filters: {
    importJobId: string;
    severity?: string;
    issueType?: string;
    limit?: number;
  }): Promise<unknown[]>;

  getSampleData(tenantId: string, filters: {
    importJobId: string;
    startRow?: number;
    endRow?: number;
    columns?: string[];
  }): Promise<unknown>;

  getFieldStats(tenantId: string, filters: {
    importJobId: string;
    fieldName?: string;
  }): Promise<unknown>;

  getHistoricalImports(tenantId: string, filters: {
    limit?: number;
    status?: string;
  }): Promise<unknown[]>;
}

/**
 * Create all data quality domain tools bound to a specific tenant.
 */
export function createDataQualityTools(
  tenantId: string,
  db: DataQualityDbAdapter,
): StructuredToolInterface[] {
  const getImportIssues = createDomainTool({
    name: 'get_import_issues',
    description: 'Get detected data quality issues for an import job. Returns issues with row, column, type, severity, original value, and suggested fix.',
    schema: z.object({
      importJobId: z.string().describe('The import job ID to get issues for'),
      severity: z.string().optional().describe('Filter by severity: ERROR, WARNING, INFO'),
      issueType: z.string().optional().describe('Filter by issue type: BOM, NBSP, ENCODING, INVALID_FORMAT, DUPLICATE, MISSING_REQUIRED, OUT_OF_RANGE'),
      limit: z.number().optional().default(100).describe('Max issues to return'),
    }),
    func: async (input) => db.getImportIssues(tenantId, input),
  });

  const getSampleData = createDomainTool({
    name: 'get_sample_data',
    description: 'Get sample rows from an import file to understand the data structure and content. Returns headers and row data.',
    schema: z.object({
      importJobId: z.string().describe('The import job ID'),
      startRow: z.number().optional().default(0).describe('Starting row index'),
      endRow: z.number().optional().default(10).describe('Ending row index'),
      columns: z.array(z.string()).optional().describe('Specific columns to return'),
    }),
    func: async (input) => db.getSampleData(tenantId, input),
  });

  const getFieldStats = createDomainTool({
    name: 'get_field_stats',
    description: 'Get statistics for fields in an import file: null counts, unique values, min/max, data type distribution. Useful for understanding data quality patterns.',
    schema: z.object({
      importJobId: z.string().describe('The import job ID'),
      fieldName: z.string().optional().describe('Specific field name to get stats for. If omitted, returns stats for all fields.'),
    }),
    func: async (input) => db.getFieldStats(tenantId, input),
  });

  const getHistoricalImports = createDomainTool({
    name: 'get_historical_imports',
    description: 'Get historical import jobs to compare patterns and identify recurring data quality issues across imports.',
    schema: z.object({
      limit: z.number().optional().default(10).describe('Max historical imports to return'),
      status: z.string().optional().describe('Filter by status: COMPLETED, APPROVED, REVIEW'),
    }),
    func: async (input) => db.getHistoricalImports(tenantId, input),
  });

  return [getImportIssues, getSampleData, getFieldStats, getHistoricalImports] as StructuredToolInterface[];
}

