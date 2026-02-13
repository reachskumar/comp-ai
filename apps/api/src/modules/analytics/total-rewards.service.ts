import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import { TotalRewardsView } from './dto';

interface TotalRewardsResponse {
  employee: {
    name: string;
    title: string;
    department: string;
    employeeId: string;
  };
  totalRewardsValue: number;
  previousYearTotal: number;
  breakdown: Array<{ category: string; value: number; previousValue: number }>;
  marketComparison: Array<{ percentile: number; value: number }>;
  timeline: Array<{ date: string; event: string; amount: number; type: string }>;
  year: number;
}

interface TeamOverviewResponse {
  teamSize: number;
  avgTotalRewards: number;
  medianTotalRewards: number;
  departmentBreakdown: Array<{ category: string; avgValue: number }>;
  headcountByLevel: Array<{ level: string; count: number; avgComp: number }>;
}

@Injectable()
export class TotalRewardsService {
  private readonly logger = new Logger(TotalRewardsService.name);

  constructor(private readonly db: DatabaseService) {}

  async getPersonalRewards(
    tenantId: string,
    userId: string,
    year?: string,
  ): Promise<TotalRewardsResponse> {
    this.logger.log(`Fetching total rewards for user=${userId} tenant=${tenantId}`);

    const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();

    // Find the employee linked to this user (by email match or first employee)
    const user = await this.db.client.user.findUnique({ where: { id: userId } });
    const employee = user
      ? await this.db.client.employee.findFirst({
          where: { tenantId, email: user.email },
        })
      : null;

    if (!employee) {
      return {
        employee: { name: 'Unknown', title: 'N/A', department: 'N/A', employeeId: userId },
        totalRewardsValue: 0,
        previousYearTotal: 0,
        breakdown: [],
        marketComparison: [],
        timeline: [],
        year: currentYear,
      };
    }

    const baseSalary = Number(employee.baseSalary);
    const totalComp = Number(employee.totalComp);

    // Get benefit enrollments for this employee
    const enrollments = await this.db.client.benefitEnrollment.findMany({
      where: { tenantId, employeeId: employee.id, status: 'ACTIVE' },
    });
    const benefitsValue = enrollments.reduce(
      (sum, e) => sum + Number(e.employerPremium) * 12,
      0,
    );

    // Estimate bonus as totalComp - baseSalary - benefits (if positive)
    const bonusEstimate = Math.max(0, totalComp - baseSalary - benefitsValue);

    const totalRewardsValue = Math.round(baseSalary + bonusEstimate + benefitsValue);

    const breakdown: TotalRewardsResponse['breakdown'] = [
      { category: 'Base Salary', value: Math.round(baseSalary), previousValue: 0 },
    ];
    if (bonusEstimate > 0) {
      breakdown.push({ category: 'Bonus / Variable', value: Math.round(bonusEstimate), previousValue: 0 });
    }
    if (benefitsValue > 0) {
      breakdown.push({ category: 'Benefits', value: Math.round(benefitsValue), previousValue: 0 });
    }

    return {
      employee: {
        name: `${employee.firstName} ${employee.lastName}`,
        title: employee.level,
        department: employee.department,
        employeeId: employee.id,
      },
      totalRewardsValue,
      previousYearTotal: 0,
      breakdown,
      marketComparison: [],
      timeline: [],
      year: currentYear,
    };
  }

  async getTeamOverview(
    tenantId: string,
    userId: string,
    userRole: string,
  ): Promise<TeamOverviewResponse> {
    const allowedRoles = ['manager', 'hr', 'admin', 'super_admin', 'ADMIN', 'HR', 'MANAGER'];
    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenException('Only managers and HR can view team rewards overview');
    }

    this.logger.log(`Fetching team overview for manager=${userId} tenant=${tenantId}`);

    const employees = await this.db.client.employee.findMany({
      where: { tenantId, terminationDate: null },
      select: { baseSalary: true, totalComp: true, level: true, department: true },
    });

    if (employees.length === 0) {
      return {
        teamSize: 0,
        avgTotalRewards: 0,
        medianTotalRewards: 0,
        departmentBreakdown: [],
        headcountByLevel: [],
      };
    }

    const comps = employees.map((e) => Number(e.totalComp) || Number(e.baseSalary));
    const sorted = [...comps].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianTotalRewards = sorted.length % 2 !== 0
      ? sorted[mid]!
      : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
    const avgTotalRewards = Math.round(comps.reduce((s, v) => s + v, 0) / comps.length);

    // Department breakdown: avg base salary per department
    const deptMap = new Map<string, { total: number; count: number }>();
    for (const emp of employees) {
      const salary = Number(emp.baseSalary);
      const existing = deptMap.get(emp.department) ?? { total: 0, count: 0 };
      existing.total += salary;
      existing.count += 1;
      deptMap.set(emp.department, existing);
    }
    const departmentBreakdown = [...deptMap.entries()].map(([category, d]) => ({
      category,
      avgValue: Math.round(d.total / d.count),
    }));

    // Headcount by level
    const levelMap = new Map<string, { total: number; count: number }>();
    for (const emp of employees) {
      const comp = Number(emp.totalComp) || Number(emp.baseSalary);
      const existing = levelMap.get(emp.level) ?? { total: 0, count: 0 };
      existing.total += comp;
      existing.count += 1;
      levelMap.set(emp.level, existing);
    }
    const headcountByLevel = [...levelMap.entries()].map(([level, d]) => ({
      level,
      count: d.count,
      avgComp: Math.round(d.total / d.count),
    }));

    return {
      teamSize: employees.length,
      avgTotalRewards,
      medianTotalRewards,
      departmentBreakdown,
      headcountByLevel,
    };
  }
}

