import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database';

export interface HrDashboardResponse {
  headcountByDepartment: Array<{ department: string; count: number }>;
  salaryDistribution: Array<{ range: string; count: number }>;
  avgSalaryByLevel: Array<{ level: string; avgSalary: number; count: number }>;
  summary: {
    totalEmployees: number;
    avgSalary: number;
    medianSalary: number;
    totalPayroll: number;
  };
}

@Injectable()
export class HrDashboardService {
  private readonly logger = new Logger(HrDashboardService.name);

  constructor(private readonly db: DatabaseService) {}

  async getDashboard(tenantId: string): Promise<HrDashboardResponse> {
    this.logger.log(`HR Dashboard request: tenant=${tenantId}`);

    const employees = await this.db.client.employee.findMany({
      where: { tenantId, terminationDate: null },
      select: {
        department: true,
        level: true,
        baseSalary: true,
      },
    });

    if (employees.length === 0) {
      return {
        headcountByDepartment: [],
        salaryDistribution: [],
        avgSalaryByLevel: [],
        summary: { totalEmployees: 0, avgSalary: 0, medianSalary: 0, totalPayroll: 0 },
      };
    }

    // Headcount by department
    const deptMap = new Map<string, number>();
    for (const emp of employees) {
      deptMap.set(emp.department, (deptMap.get(emp.department) ?? 0) + 1);
    }
    const headcountByDepartment = [...deptMap.entries()]
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count);

    // Salary distribution (histogram buckets)
    const salaries = employees.map((e) => Number(e.baseSalary)).filter((s) => s > 0);
    const salaryDistribution = this.buildSalaryDistribution(salaries);

    // Average salary by level
    const levelMap = new Map<string, { total: number; count: number }>();
    for (const emp of employees) {
      const salary = Number(emp.baseSalary);
      if (salary <= 0) continue;
      const existing = levelMap.get(emp.level) ?? { total: 0, count: 0 };
      existing.total += salary;
      existing.count += 1;
      levelMap.set(emp.level, existing);
    }
    const avgSalaryByLevel = [...levelMap.entries()]
      .map(([level, data]) => ({
        level,
        avgSalary: Math.round(data.total / data.count),
        count: data.count,
      }))
      .sort((a, b) => b.avgSalary - a.avgSalary);

    // Summary stats
    const totalPayroll = salaries.reduce((s, v) => s + v, 0);
    const avgSalary = salaries.length > 0 ? Math.round(totalPayroll / salaries.length) : 0;
    const sorted = [...salaries].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianSalary = sorted.length % 2 !== 0
      ? sorted[mid]!
      : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);

    return {
      headcountByDepartment,
      salaryDistribution,
      avgSalaryByLevel,
      summary: {
        totalEmployees: employees.length,
        avgSalary,
        medianSalary,
        totalPayroll: Math.round(totalPayroll),
      },
    };
  }

  private buildSalaryDistribution(salaries: number[]): Array<{ range: string; count: number }> {
    if (salaries.length === 0) return [];

    const min = Math.min(...salaries);
    const max = Math.max(...salaries);
    const bucketSize = Math.max(10000, Math.ceil((max - min) / 8 / 10000) * 10000);
    const bucketStart = Math.floor(min / bucketSize) * bucketSize;

    const buckets = new Map<string, number>();
    for (const salary of salaries) {
      const lower = Math.floor((salary - bucketStart) / bucketSize) * bucketSize + bucketStart;
      const upper = lower + bucketSize;
      const label = `$${(lower / 1000).toFixed(0)}k–$${(upper / 1000).toFixed(0)}k`;
      buckets.set(label, (buckets.get(label) ?? 0) + 1);
    }

    return [...buckets.entries()].map(([range, count]) => ({ range, count }));
  }
}

