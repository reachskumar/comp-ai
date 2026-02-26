import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { invokeBudgetOptimizer, type BudgetOptimizerDbAdapter } from '@compensation/ai';
import { CycleService } from '../cycle.service';

@Injectable()
export class BudgetOptimizerService implements BudgetOptimizerDbAdapter {
  private readonly logger = new Logger(BudgetOptimizerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cycleService: CycleService,
  ) {}

  // ─── Graph Invocation ──────────────────────────────────────

  async optimize(
    tenantId: string,
    userId: string,
    cycleId: string,
    totalBudget: number,
    constraints?: {
      minPerDept?: number;
      maxPerDept?: number;
      priorityDepartments?: string[];
    },
  ) {
    this.logger.log(`Budget optimize: tenant=${tenantId} cycle=${cycleId} budget=${totalBudget}`);

    // Verify cycle exists
    await this.cycleService.getCycle(tenantId, cycleId);

    const result = await invokeBudgetOptimizer(
      { tenantId, userId, cycleId, totalBudget, constraints },
      this,
    );

    // Try to parse structured JSON from the response
    let parsed: Record<string, unknown> | null = null;
    try {
      // Extract JSON from the response (may be wrapped in markdown code blocks)
      const jsonMatch = result.response.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [
        null,
        result.response,
      ];
      parsed = JSON.parse(jsonMatch[1]!.trim());
    } catch {
      this.logger.warn('Could not parse structured response from AI');
    }

    return {
      cycleId,
      totalBudget,
      raw: result.response,
      ...(parsed ?? {}),
    };
  }

  async applyAllocation(
    tenantId: string,
    cycleId: string,
    allocations: Array<{ department: string; amount: number }>,
  ) {
    this.logger.log(`Apply budget allocation: tenant=${tenantId} cycle=${cycleId}`);

    return this.cycleService.setBudgets(tenantId, cycleId, {
      budgets: allocations.map((a) => ({
        department: a.department,
        allocated: a.amount,
      })),
    });
  }

  // ─── BudgetOptimizerDbAdapter Implementation ────────────────

  async getDepartmentStats(tenantId: string, cycleId: string): Promise<unknown[]> {
    const employees = await this.db.client.employee.findMany({
      where: { tenantId, terminationDate: null },
      select: {
        department: true,
        baseSalary: true,
        compaRatio: true,
      },
    });

    const deptMap: Record<
      string,
      { count: number; totalSalary: number; totalCR: number; crCount: number }
    > = {};
    for (const emp of employees) {
      if (!deptMap[emp.department]) {
        deptMap[emp.department] = { count: 0, totalSalary: 0, totalCR: 0, crCount: 0 };
      }
      const d = deptMap[emp.department]!;
      d.count++;
      d.totalSalary += Number(emp.baseSalary);
      if (emp.compaRatio) {
        d.totalCR += Number(emp.compaRatio);
        d.crCount++;
      }
    }

    return Object.entries(deptMap).map(([dept, data]) => ({
      department: dept,
      headcount: data.count,
      avgSalary: Math.round(data.totalSalary / data.count),
      avgCompaRatio:
        data.crCount > 0 ? Math.round((data.totalCR / data.crCount) * 100) / 100 : null,
      totalPayroll: Math.round(data.totalSalary),
    }));
  }

  async getAttritionRiskByDepartment(tenantId: string): Promise<unknown[]> {
    const scores = await this.db.client.attritionRiskScore.findMany({
      where: { tenantId },
      include: { employee: { select: { department: true } } },
    });

    const deptMap: Record<
      string,
      {
        LOW: number;
        MEDIUM: number;
        HIGH: number;
        CRITICAL: number;
        total: number;
        sumScore: number;
      }
    > = {};
    for (const s of scores) {
      const dept = s.employee.department;
      if (!deptMap[dept]) {
        deptMap[dept] = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, total: 0, sumScore: 0 };
      }
      const d = deptMap[dept]!;
      d[s.riskLevel as keyof typeof d]++;
      d.total++;
      d.sumScore += s.riskScore;
    }

    return Object.entries(deptMap).map(([dept, data]) => ({
      department: dept,
      distribution: {
        LOW: data.LOW,
        MEDIUM: data.MEDIUM,
        HIGH: data.HIGH,
        CRITICAL: data.CRITICAL,
      },
      avgRiskScore: data.total > 0 ? Math.round((data.sumScore / data.total) * 10) / 10 : 0,
      highRiskCount: data.HIGH + data.CRITICAL,
      totalScored: data.total,
    }));
  }

  async getEquityGapsByDepartment(tenantId: string): Promise<unknown[]> {
    const employees = await this.db.client.employee.findMany({
      where: { tenantId, terminationDate: null },
      select: {
        department: true,
        baseSalary: true,
        compaRatio: true,
        salaryBand: { select: { p50: true } },
      },
    });

    const deptMap: Record<
      string,
      {
        count: number;
        belowMidpoint: number;
        totalCRGap: number;
        crGapCount: number;
      }
    > = {};

    for (const emp of employees) {
      const dept = emp.department;
      if (!deptMap[dept]) {
        deptMap[dept] = { count: 0, belowMidpoint: 0, totalCRGap: 0, crGapCount: 0 };
      }
      const d = deptMap[dept]!;
      d.count++;

      if (emp.compaRatio && Number(emp.compaRatio) < 1.0) {
        d.totalCRGap += 1.0 - Number(emp.compaRatio);
        d.crGapCount++;
      }

      if (emp.salaryBand && Number(emp.baseSalary) < Number(emp.salaryBand.p50)) {
        d.belowMidpoint++;
      }
    }

    return Object.entries(deptMap).map(([dept, data]) => ({
      department: dept,
      employeeCount: data.count,
      belowMidpoint: data.belowMidpoint,
      belowMidpointPct: data.count > 0 ? Math.round((data.belowMidpoint / data.count) * 100) : 0,
      avgCompaRatioGap:
        data.crGapCount > 0 ? Math.round((data.totalCRGap / data.crGapCount) * 100) / 100 : 0,
    }));
  }

  async getCurrentBudgetAllocations(tenantId: string, cycleId: string): Promise<unknown[]> {
    await this.cycleService.getCycle(tenantId, cycleId);

    const budgets = await this.db.client.cycleBudget.findMany({
      where: { cycleId },
    });

    return budgets.map((b) => ({
      department: b.department,
      allocated: Number(b.allocated),
      spent: Number(b.spent),
      remaining: Number(b.remaining),
      managerId: b.managerId,
    }));
  }

  async getHistoricalUtilization(tenantId: string): Promise<unknown[]> {
    const cycles = await this.db.client.compCycle.findMany({
      where: { tenantId, status: 'COMPLETED' },
      include: { budgets: true },
      orderBy: { endDate: 'desc' },
      take: 5,
    });

    return cycles.map((cycle) => {
      const deptUtil: Record<string, { allocated: number; spent: number }> = {};
      let totalAllocated = 0;
      let totalSpent = 0;
      for (const b of cycle.budgets) {
        deptUtil[b.department] = {
          allocated: Number(b.allocated),
          spent: Number(b.spent),
        };
        totalAllocated += Number(b.allocated);
        totalSpent += Number(b.spent);
      }
      return {
        cycleId: cycle.id,
        cycleName: cycle.name,
        endDate: cycle.endDate,
        totalBudget: Number(cycle.budgetTotal),
        totalAllocated,
        totalSpent,
        utilizationPct:
          Number(cycle.budgetTotal) > 0
            ? Math.round((totalSpent / Number(cycle.budgetTotal)) * 100)
            : 0,
        departmentUtilization: deptUtil,
      };
    });
  }
}
