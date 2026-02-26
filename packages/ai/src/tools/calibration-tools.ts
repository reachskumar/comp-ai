/**
 * Calibration Assistant domain tools — LangGraph tools for the AI Calibration Assistant.
 *
 * Each tool receives a tenantId injected at graph construction time
 * to enforce multi-tenant isolation.
 */

import { z } from 'zod';
import { createDomainTool } from '../tools.js';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * Database adapter for calibration assistant tools.
 * Decouples tools from Prisma so the AI package stays DB-agnostic.
 */
export interface CalibrationDbAdapter {
  getSessionRecommendations(
    tenantId: string,
    filters: {
      cycleId: string;
      sessionId: string;
    },
  ): Promise<unknown[]>;

  getEmployeeDetails(
    tenantId: string,
    filters: {
      employeeIds: string[];
    },
  ): Promise<unknown[]>;

  getAttritionRiskScores(
    tenantId: string,
    filters: {
      employeeIds: string[];
    },
  ): Promise<unknown[]>;

  getCycleBudget(
    tenantId: string,
    filters: {
      cycleId: string;
      department?: string;
    },
  ): Promise<unknown>;

  getDepartmentStats(
    tenantId: string,
    filters: {
      department: string;
      cycleId: string;
    },
  ): Promise<unknown>;
}

/**
 * Create all calibration assistant tools bound to a specific tenant.
 */
export function createCalibrationTools(
  tenantId: string,
  db: CalibrationDbAdapter,
): StructuredToolInterface[] {
  const getSessionRecommendations = createDomainTool({
    name: 'get_session_recommendations',
    description:
      'Get all compensation recommendations in a calibration session with employee details including current salary, proposed salary, compa-ratio, performance rating, department, and level.',
    schema: z.object({
      cycleId: z.string().describe('The compensation cycle ID'),
      sessionId: z.string().describe('The calibration session ID'),
    }),
    func: async (input) => db.getSessionRecommendations(tenantId, input),
  });

  const getEmployeeDetails = createDomainTool({
    name: 'get_employee_details',
    description:
      'Get detailed employee information including demographics, salary band, compa-ratio, performance rating, hire date, and department for pay equity analysis.',
    schema: z.object({
      employeeIds: z.array(z.string()).describe('Array of employee IDs to look up'),
    }),
    func: async (input) => db.getEmployeeDetails(tenantId, input),
  });

  const getAttritionRiskScores = createDomainTool({
    name: 'get_attrition_risk_scores',
    description:
      'Get attrition/retention risk scores for employees. Returns risk level (LOW/MEDIUM/HIGH/CRITICAL), risk score (0-100), and contributing factors.',
    schema: z.object({
      employeeIds: z.array(z.string()).describe('Array of employee IDs to get risk scores for'),
    }),
    func: async (input) => db.getAttritionRiskScores(tenantId, input),
  });

  const getCycleBudget = createDomainTool({
    name: 'get_cycle_budget',
    description:
      'Get the budget allocation and remaining budget for a compensation cycle, optionally filtered by department.',
    schema: z.object({
      cycleId: z.string().describe('The compensation cycle ID'),
      department: z.string().optional().describe('Filter by department'),
    }),
    func: async (input) => db.getCycleBudget(tenantId, input),
  });

  const getDepartmentStats = createDomainTool({
    name: 'get_department_stats',
    description:
      'Get aggregate compensation statistics for a department including average salary, median increase, headcount by level, and pay distribution.',
    schema: z.object({
      department: z.string().describe('Department name'),
      cycleId: z.string().describe('The compensation cycle ID'),
    }),
    func: async (input) => db.getDepartmentStats(tenantId, input),
  });

  return [
    getSessionRecommendations,
    getEmployeeDetails,
    getAttritionRiskScores,
    getCycleBudget,
    getDepartmentStats,
  ] as StructuredToolInterface[];
}
