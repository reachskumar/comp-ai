import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import {
  evaluateRules,
  type EmployeeData,
  type RuleSet,
  type RuleCondition,
  type RuleAction,
} from '@compensation/shared';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface SimulationParams {
  departmentFilter?: string[];
  levelFilter?: string[];
  locationFilter?: string[];
  maxEmployees?: number;
}

export interface EmployeeSimResult {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  level: string;
  before: { baseSalary: number; totalComp: number };
  after: { merit: number; bonus: number; lti: number; newTotal: number };
  changePercent: number;
  blocked: boolean;
  flags: string[];
}

interface DeptSummary {
  totalBudgetImpact: number;
  avgChangePercent: number;
  employeesAffected: number;
  employeesBlocked: number;
}

interface LevelSummary {
  totalBudgetImpact: number;
  avgChangePercent: number;
  employeesAffected: number;
}

export interface ImpactSummary {
  totalBudgetImpact: number;
  avgChangePercent: number;
  medianChangePercent: number;
  byDepartment: Record<string, DeptSummary>;
  byLevel: Record<string, LevelSummary>;
  employeesAffected: number;
  employeesBlocked: number;
}

export interface SimulationReport {
  simulationRunId: string;
  ruleSetId: string;
  totalEmployees: number;
  results: EmployeeSimResult[];
  impactSummary: ImpactSummary;
  outliers: EmployeeSimResult[];
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function toEmployeeData(employee: {
  id: string;
  tenantId: string;
  employeeCode: string;
  email: string;
  firstName: string;
  lastName: string;
  department: string;
  level: string;
  location: string | null;
  managerId: string | null;
  hireDate: Date;
  terminationDate: Date | null;
  currency: string;
  baseSalary: unknown;
  totalComp: unknown;
  metadata: unknown;
}): EmployeeData {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    department: employee.department,
    level: employee.level,
    location: employee.location ?? undefined,
    managerId: employee.managerId ?? undefined,
    hireDate: employee.hireDate,
    terminationDate: employee.terminationDate ?? undefined,
    baseSalary: Number(employee.baseSalary),
    performanceRating: undefined,
  };
}

function buildRuleSet(
  dbRuleSet: { id: string; name: string; effectiveDate: Date | null; rules: Array<{ id: string; name: string; ruleType: string; priority: number; conditions: unknown; actions: unknown; enabled: boolean }> },
): RuleSet {
  return {
    id: dbRuleSet.id,
    name: dbRuleSet.name,
    effectiveDate: dbRuleSet.effectiveDate ?? undefined,
    rules: dbRuleSet.rules.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.ruleType as RuleSet['rules'][number]['type'],
      priority: r.priority,
      conditions: (Array.isArray(r.conditions) ? r.conditions : []) as RuleCondition[],
      actions: (Array.isArray(r.actions) ? r.actions : []) as RuleAction[],
      enabled: r.enabled,
    })),
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function detectOutliers(results: EmployeeSimResult[]): EmployeeSimResult[] {
  const changes = results.map((r) => r.changePercent);
  if (changes.length < 3) return [];
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((a, b) => a + (b - mean) ** 2, 0) / changes.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return [];
  return results.filter((r) => Math.abs(r.changePercent - mean) > 2 * stdDev);
}

function buildImpactSummary(results: EmployeeSimResult[]): ImpactSummary {
  const byDepartment: Record<string, DeptSummary> = {};
  const byLevel: Record<string, LevelSummary> = {};
  let totalBudgetImpact = 0;
  let employeesAffected = 0;
  let employeesBlocked = 0;
  const changePercents: number[] = [];

  for (const r of results) {
    const impact = r.after.merit + r.after.bonus + r.after.lti;
    totalBudgetImpact += impact;
    changePercents.push(r.changePercent);
    if (impact > 0) employeesAffected++;
    if (r.blocked) employeesBlocked++;

    // By department
    if (!byDepartment[r.department]) {
      byDepartment[r.department] = { totalBudgetImpact: 0, avgChangePercent: 0, employeesAffected: 0, employeesBlocked: 0 };
    }
    const dept = byDepartment[r.department]!;
    dept.totalBudgetImpact += impact;
    dept.employeesAffected += impact > 0 ? 1 : 0;
    dept.employeesBlocked += r.blocked ? 1 : 0;

    // By level
    if (!byLevel[r.level]) {
      byLevel[r.level] = { totalBudgetImpact: 0, avgChangePercent: 0, employeesAffected: 0 };
    }
    const lvl = byLevel[r.level]!;
    lvl.totalBudgetImpact += impact;
    lvl.employeesAffected += impact > 0 ? 1 : 0;
  }

  // Compute averages per department
  for (const [dept, summary] of Object.entries(byDepartment)) {
    const deptResults = results.filter((r) => r.department === dept);
    summary.avgChangePercent = deptResults.length > 0
      ? deptResults.reduce((a, b) => a + b.changePercent, 0) / deptResults.length
      : 0;
  }

  // Compute averages per level
  for (const [level, summary] of Object.entries(byLevel)) {
    const lvlResults = results.filter((r) => r.level === level);
    summary.avgChangePercent = lvlResults.length > 0
      ? lvlResults.reduce((a, b) => a + b.changePercent, 0) / lvlResults.length
      : 0;
  }

  const avgChangePercent = changePercents.length > 0
    ? changePercents.reduce((a, b) => a + b, 0) / changePercents.length
    : 0;

  return {
    totalBudgetImpact,
    avgChangePercent,
    medianChangePercent: median(changePercents),
    byDepartment,
    byLevel,
    employeesAffected,
    employeesBlocked,
  };
}


// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class SimulatorService {
  private readonly logger = new Logger(SimulatorService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Run a sandbox simulation of a RuleSet against the employee population.
   */
  async runSimulation(
    tenantId: string,
    userId: string,
    ruleSetId: string,
    params: SimulationParams,
  ): Promise<SimulationReport> {
    // 1. Verify RuleSet exists and belongs to tenant
    const dbRuleSet = await this.db.client.ruleSet.findFirst({
      where: { id: ruleSetId, tenantId },
      include: { rules: true },
    });
    if (!dbRuleSet) {
      throw new NotFoundException(`RuleSet ${ruleSetId} not found`);
    }

    // 2. Create SimulationRun record
    const simulationRun = await this.db.client.simulationRun.create({
      data: {
        tenantId,
        ruleSetId,
        userId,
        status: 'RUNNING',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parameters: params as any,
      },
    });

    try {
      // 3. Build the engine RuleSet
      const ruleSet = buildRuleSet(dbRuleSet);

      // 4. Load employees with optional filters
      const employeeWhere: Record<string, unknown> = { tenantId };
      if (params.departmentFilter?.length) {
        employeeWhere['department'] = { in: params.departmentFilter };
      }
      if (params.levelFilter?.length) {
        employeeWhere['level'] = { in: params.levelFilter };
      }
      if (params.locationFilter?.length) {
        employeeWhere['location'] = { in: params.locationFilter };
      }

      const employees = await this.db.client.employee.findMany({
        where: employeeWhere,
        take: params.maxEmployees ?? undefined,
      });

      // 5. Evaluate each employee
      const results: EmployeeSimResult[] = [];
      for (const emp of employees) {
        const empData = toEmployeeData(emp);
        const evalResult = evaluateRules(empData, ruleSet);

        const baseSalary = Number(emp.baseSalary);
        const totalComp = Number(emp.totalComp);
        const totalChange = evalResult.totalMerit + evalResult.totalBonus + evalResult.totalLTI;
        const changePercent = baseSalary > 0 ? (totalChange / baseSalary) * 100 : 0;

        const simResult: EmployeeSimResult = {
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          name: `${emp.firstName} ${emp.lastName}`,
          department: emp.department,
          level: emp.level,
          before: { baseSalary, totalComp },
          after: {
            merit: evalResult.totalMerit,
            bonus: evalResult.totalBonus,
            lti: evalResult.totalLTI,
            newTotal: totalComp + totalChange,
          },
          changePercent: Math.round(changePercent * 100) / 100,
          blocked: evalResult.blocked,
          flags: evalResult.flags,
        };

        results.push(simResult);

        // Store individual result
        await this.db.client.simulationResult.create({
          data: {
            simulationRunId: simulationRun.id,
            employeeId: emp.id,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input: empData as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            output: evalResult as any,
            delta: {
              merit: evalResult.totalMerit,
              bonus: evalResult.totalBonus,
              lti: evalResult.totalLTI,
              changePercent: simResult.changePercent,
              blocked: evalResult.blocked,
            },
          },
        });
      }

      // 6. Build impact summary and detect outliers
      const impactSummary = buildImpactSummary(results);
      const outliers = detectOutliers(results);

      // 7. Update SimulationRun as completed
      await this.db.client.simulationRun.update({
        where: { id: simulationRun.id },
        data: {
          status: 'COMPLETED',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          impactSummary: impactSummary as any,
          completedAt: new Date(),
        },
      });

      this.logger.log(`Simulation ${simulationRun.id} completed: ${results.length} employees processed`);

      return {
        simulationRunId: simulationRun.id,
        ruleSetId,
        totalEmployees: results.length,
        results,
        impactSummary,
        outliers,
      };
    } catch (error) {
      // Mark as failed
      await this.db.client.simulationRun.update({
        where: { id: simulationRun.id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }

  /**
   * Retrieve a previously run simulation by ID.
   */
  async getSimulation(tenantId: string, simulationRunId: string): Promise<SimulationReport> {
    const run = await this.db.client.simulationRun.findFirst({
      where: { id: simulationRunId, tenantId },
      include: { results: true },
    });
    if (!run) {
      throw new NotFoundException(`SimulationRun ${simulationRunId} not found`);
    }

    const results: EmployeeSimResult[] = run.results.map((r) => {
      const delta = r.delta as Record<string, unknown> | null;
      const input = r.input as Record<string, unknown>;
      return {
        employeeId: r.employeeId ?? '',
        employeeCode: (input['employeeCode'] as string) ?? '',
        name: `${(input['firstName'] as string) ?? ''} ${(input['lastName'] as string) ?? ''}`.trim(),
        department: (input['department'] as string) ?? '',
        level: (input['level'] as string) ?? '',
        before: {
          baseSalary: Number(input['baseSalary'] ?? 0),
          totalComp: Number(input['totalComp'] ?? 0),
        },
        after: {
          merit: Number(delta?.['merit'] ?? 0),
          bonus: Number(delta?.['bonus'] ?? 0),
          lti: Number(delta?.['lti'] ?? 0),
          newTotal: Number(input['totalComp'] ?? 0) + Number(delta?.['merit'] ?? 0) + Number(delta?.['bonus'] ?? 0) + Number(delta?.['lti'] ?? 0),
        },
        changePercent: Number(delta?.['changePercent'] ?? 0),
        blocked: Boolean(delta?.['blocked']),
        flags: [],
      };
    });

    const impactSummary = (run.impactSummary as unknown as ImpactSummary) ?? buildImpactSummary(results);
    const outliers = detectOutliers(results);

    return {
      simulationRunId: run.id,
      ruleSetId: run.ruleSetId,
      totalEmployees: results.length,
      results,
      impactSummary,
      outliers,
    };
  }
}