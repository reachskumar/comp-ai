import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
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

  async getPersonalRewards(
    tenantId: string,
    userId: string,
    year?: string,
  ): Promise<TotalRewardsResponse> {
    this.logger.log(`Fetching total rewards for user=${userId} tenant=${tenantId}`);

    // Mock data — will be replaced with real DB aggregation
    const currentYear = year ? parseInt(year, 10) : new Date().getFullYear();
    return {
      employee: {
        name: 'Sarah Johnson',
        title: 'Senior Software Engineer',
        department: 'Engineering',
        employeeId: userId,
      },
      totalRewardsValue: 187500,
      previousYearTotal: 172000,
      breakdown: [
        { category: 'Base Salary', value: 125000, previousValue: 118000 },
        { category: 'Annual Bonus', value: 25000, previousValue: 22000 },
        { category: 'Equity/LTI', value: 18000, previousValue: 15000 },
        { category: 'Health Benefits', value: 12500, previousValue: 11500 },
        { category: 'Retirement', value: 5000, previousValue: 4500 },
        { category: 'Perks & Allowances', value: 2000, previousValue: 1000 },
      ],
      marketComparison: [
        { percentile: 25, value: 145000 },
        { percentile: 50, value: 170000 },
        { percentile: 75, value: 195000 },
        { percentile: 90, value: 225000 },
      ],
      timeline: [
        { date: '2026-01-15', event: 'Annual Merit Increase', amount: 7000, type: 'raise' },
        { date: '2025-12-01', event: 'Year-End Bonus', amount: 25000, type: 'bonus' },
        { date: '2025-07-01', event: 'Equity Vest', amount: 6000, type: 'equity' },
        { date: '2025-03-15', event: 'Promotion to Senior', amount: 12000, type: 'promotion' },
        { date: '2025-01-15', event: 'Annual Merit Increase', amount: 5500, type: 'raise' },
      ],
      year: currentYear,
    };
  }

  async getTeamOverview(
    tenantId: string,
    userId: string,
    userRole: string,
  ): Promise<TeamOverviewResponse> {
    // Security: only managers, HR, and admins can see team data
    const allowedRoles = ['manager', 'hr', 'admin', 'super_admin'];
    if (!allowedRoles.includes(userRole)) {
      throw new ForbiddenException('Only managers and HR can view team rewards overview');
    }

    this.logger.log(`Fetching team overview for manager=${userId} tenant=${tenantId}`);

    return {
      teamSize: 12,
      avgTotalRewards: 165000,
      medianTotalRewards: 158000,
      departmentBreakdown: [
        { category: 'Base Salary', avgValue: 110000 },
        { category: 'Annual Bonus', avgValue: 22000 },
        { category: 'Equity/LTI', avgValue: 15000 },
        { category: 'Health Benefits', avgValue: 12000 },
        { category: 'Retirement', avgValue: 4500 },
        { category: 'Perks & Allowances', avgValue: 1500 },
      ],
      headcountByLevel: [
        { level: 'Junior', count: 3, avgComp: 95000 },
        { level: 'Mid', count: 5, avgComp: 145000 },
        { level: 'Senior', count: 3, avgComp: 190000 },
        { level: 'Lead', count: 1, avgComp: 230000 },
      ],
    };
  }
}

