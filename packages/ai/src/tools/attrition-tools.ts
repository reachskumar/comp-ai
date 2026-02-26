/**
 * Attrition prediction tools — provides employee data lookup for the AI graph.
 */

import { z } from 'zod';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { createDomainTool } from '../tools.js';

/**
 * Database adapter interface for attrition tools.
 */
export interface AttritionDbAdapter {
  getHighRiskEmployees: (
    tenantId: string,
    filters?: { riskLevel?: string; department?: string; limit?: number },
  ) => Promise<unknown[]>;
  getEmployeeRiskDetail: (tenantId: string, employeeId: string) => Promise<unknown>;
}

/**
 * Create all attrition prediction tools bound to a specific tenant.
 */
export function createAttritionTools(
  tenantId: string,
  db: AttritionDbAdapter,
): StructuredToolInterface[] {
  const getHighRiskEmployees = createDomainTool({
    name: 'get_high_risk_employees',
    description:
      'Get employees with HIGH or CRITICAL attrition risk scores. Returns employee name, department, risk score, risk level, and contributing factors.',
    schema: z.object({
      riskLevel: z.enum(['HIGH', 'CRITICAL']).optional().describe('Filter by risk level'),
      department: z.string().optional().describe('Filter by department'),
      limit: z.number().optional().default(10).describe('Max employees to return'),
    }),
    func: async ({ riskLevel, department, limit }) => {
      return db.getHighRiskEmployees(tenantId, {
        riskLevel,
        department,
        limit,
      });
    },
  });

  const getEmployeeRiskDetail = createDomainTool({
    name: 'get_employee_risk_detail',
    description:
      'Get detailed risk breakdown for a specific employee including all risk factors, scores, and compensation data.',
    schema: z.object({
      employeeId: z.string().describe('The employee ID to look up'),
    }),
    func: async ({ employeeId }) => {
      return db.getEmployeeRiskDetail(tenantId, employeeId);
    },
  });

  return [getHighRiskEmployees, getEmployeeRiskDetail] as StructuredToolInterface[];
}
