import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import { invokeAttritionPredictor, type AttritionDbAdapter } from '@compensation/ai';

interface RiskFactors {
  compaRatioRisk: number;
  tenureRisk: number;
  performancePayGap: number;
  timeSinceIncrease: number;
  marketPosition: number;
  departmentTurnover: number;
  details: Record<string, unknown>;
}

interface EmployeeRiskResult {
  employeeId: string;
  employeeName: string;
  department: string;
  level: string;
  riskScore: number;
  riskLevel: string;
  factors: RiskFactors;
  recommendation: string | null;
}

@Injectable()
export class AttritionService {
  private readonly logger = new Logger(AttritionService.name);

  constructor(private readonly db: DatabaseService) {}

  private calculateRiskScore(emp: {
    compaRatio: number | null;
    hireDate: Date;
    performanceRating: number | null;
    baseSalary: number;
    salaryBand: { p25: number; p50: number } | null;
    lastCompChange: Date | null;
    departmentTerminationRate: number;
  }): RiskFactors {
    const cr = emp.compaRatio;
    let compaRatioRisk = 0;
    if (cr !== null) {
      if (cr < 0.85) compaRatioRisk = 30;
      else if (cr < 0.95) compaRatioRisk = 15;
      else if (cr >= 1.1) compaRatioRisk = -5;
    }
    const tenureYears = (Date.now() - emp.hireDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    let tenureRisk = 0;
    if (tenureYears >= 1 && tenureYears <= 3) tenureRisk = 20;
    else if (tenureYears < 1) tenureRisk = 10;
    else if (tenureYears > 5) tenureRisk = -10;
    let performancePayGap = 0;
    if (emp.performanceRating !== null && emp.performanceRating >= 4 && cr !== null && cr < 0.9)
      performancePayGap = 25;
    let timeSinceIncrease = 0;
    if (emp.lastCompChange) {
      const mo = (Date.now() - emp.lastCompChange.getTime()) / (30.44 * 24 * 60 * 60 * 1000);
      if (mo > 24) timeSinceIncrease = 20;
      else if (mo > 18) timeSinceIncrease = 10;
    } else {
      timeSinceIncrease = 20;
    }
    let marketPosition = 0;
    if (emp.salaryBand) {
      const sal = Number(emp.baseSalary);
      if (sal < Number(emp.salaryBand.p25)) marketPosition = 20;
      else if (sal < Number(emp.salaryBand.p50)) marketPosition = 10;
    }
    const departmentTurnover = emp.departmentTerminationRate > 15 ? 10 : 0;
    return {
      compaRatioRisk,
      tenureRisk,
      performancePayGap,
      timeSinceIncrease,
      marketPosition,
      departmentTurnover,
      details: {
        compaRatio: cr,
        tenureYears: Math.round(tenureYears * 10) / 10,
        performanceRating: emp.performanceRating,
        baseSalary: Number(emp.baseSalary),
        bandP25: emp.salaryBand ? Number(emp.salaryBand.p25) : null,
        bandP50: emp.salaryBand ? Number(emp.salaryBand.p50) : null,
        departmentTerminationRate: emp.departmentTerminationRate,
      },
    };
  }

  private computeTotal(f: RiskFactors): number {
    return Math.min(
      100,
      Math.max(
        0,
        f.compaRatioRisk +
          f.tenureRisk +
          f.performancePayGap +
          f.timeSinceIncrease +
          f.marketPosition +
          f.departmentTurnover,
      ),
    );
  }

  private getRiskLevel(score: number): string {
    if (score >= 76) return 'CRITICAL';
    if (score >= 51) return 'HIGH';
    if (score >= 26) return 'MEDIUM';
    return 'LOW';
  }

  private async getDeptTermRates(tenantId: string): Promise<Record<string, number>> {
    const emps = await this.db.client.employee.findMany({
      where: { tenantId },
      select: { department: true, terminationDate: true },
    });
    const dc: Record<string, { t: number; x: number }> = {};
    for (const e of emps) {
      if (!dc[e.department]) dc[e.department] = { t: 0, x: 0 };
      dc[e.department]!.t++;
      if (e.terminationDate) dc[e.department]!.x++;
    }
    const r: Record<string, number> = {};
    for (const [d, c] of Object.entries(dc)) r[d] = c.t > 0 ? (c.x / c.t) * 100 : 0;
    return r;
  }

  private generateFallback(factors: RiskFactors, riskLevel: string): string {
    const recs: string[] = [];
    if (factors.compaRatioRisk >= 15)
      recs.push('Consider a market adjustment to bring compensation closer to band midpoint.');
    if (factors.performancePayGap > 0)
      recs.push('High performer with below-market pay — prioritize for next merit cycle.');
    if (factors.timeSinceIncrease >= 10)
      recs.push('No recent compensation change — schedule a compensation review.');
    if (factors.marketPosition >= 10)
      recs.push('Salary below market P50 — evaluate for off-cycle adjustment.');
    if (factors.tenureRisk >= 10)
      recs.push('Employee in high-turnover tenure window — consider retention bonus.');
    if (recs.length === 0)
      recs.push('Schedule a stay interview to understand employee engagement and career goals.');
    return `[${riskLevel} RISK] Recommendations:\n• ${recs.join('\n• ')}`;
  }

  async analyzeEmployee(
    tenantId: string,
    userId: string,
    employeeId: string,
  ): Promise<EmployeeRiskResult> {
    const employee = await this.db.client.employee.findFirst({
      where: { id: employeeId, tenantId, terminationDate: null },
      include: { salaryBand: true },
    });
    if (!employee) throw new NotFoundException(`Employee ${employeeId} not found`);
    const deptRates = await this.getDeptTermRates(tenantId);
    const lastRec = await this.db.client.compRecommendation.findFirst({
      where: { employeeId, status: 'APPROVED' },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true },
    });
    const factors = this.calculateRiskScore({
      compaRatio: employee.compaRatio ? Number(employee.compaRatio) : null,
      hireDate: employee.hireDate,
      performanceRating: employee.performanceRating ? Number(employee.performanceRating) : null,
      baseSalary: Number(employee.baseSalary),
      salaryBand: employee.salaryBand
        ? { p25: Number(employee.salaryBand.p25), p50: Number(employee.salaryBand.p50) }
        : null,
      lastCompChange: lastRec?.updatedAt ?? null,
      departmentTerminationRate: deptRates[employee.department] ?? 0,
    });
    const riskScore = this.computeTotal(factors);
    const riskLevel = this.getRiskLevel(riskScore);
    let recommendation: string | null = null;
    if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
      try {
        const dbAdapter: AttritionDbAdapter = {
          getHighRiskEmployees: async () => [],
          getEmployeeRiskDetail: async () => ({}),
        };
        const result = await invokeAttritionPredictor(
          {
            tenantId,
            userId,
            employeeId,
            riskData: {
              employeeName: `${employee.firstName} ${employee.lastName}`,
              department: employee.department,
              level: employee.level,
              riskScore,
              riskLevel,
              factors: factors as unknown as Record<string, unknown>,
            },
          },
          dbAdapter,
        );
        recommendation = result.recommendation;
      } catch (err) {
        this.logger.warn(`AI recommendation failed for ${employeeId}: ${err}`);
        recommendation = this.generateFallback(factors, riskLevel);
      }
    }
    await this.db.client.attritionRiskScore.upsert({
      where: { id: `${tenantId}-${employeeId}` },
      update: {
        riskScore,
        riskLevel: riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        factors: JSON.parse(JSON.stringify(factors)),
        recommendation,
        calculatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      create: {
        id: `${tenantId}-${employeeId}`,
        tenantId,
        employeeId,
        riskScore,
        riskLevel: riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        factors: JSON.parse(JSON.stringify(factors)),
        recommendation,
        calculatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return {
      employeeId,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      department: employee.department,
      level: employee.level,
      riskScore,
      riskLevel,
      factors,
      recommendation,
    };
  }

  async analyzeAll(tenantId: string, userId: string) {
    const run = await this.db.client.attritionAnalysisRun.create({
      data: { tenantId, triggeredBy: userId, status: 'RUNNING' },
    });
    try {
      const employees = await this.db.client.employee.findMany({
        where: { tenantId, terminationDate: null },
        select: { id: true },
      });
      let highRiskCount = 0,
        criticalCount = 0,
        totalScore = 0;
      for (const emp of employees) {
        const result = await this.analyzeEmployee(tenantId, userId, emp.id);
        totalScore += result.riskScore;
        if (result.riskLevel === 'HIGH') highRiskCount++;
        if (result.riskLevel === 'CRITICAL') criticalCount++;
      }
      const avgRiskScore =
        employees.length > 0 ? Math.round((totalScore / employees.length) * 100) / 100 : 0;
      await this.db.client.attritionAnalysisRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          totalEmployees: employees.length,
          highRiskCount,
          criticalCount,
          avgRiskScore,
          completedAt: new Date(),
        },
      });
      return {
        runId: run.id,
        totalEmployees: employees.length,
        highRiskCount,
        criticalCount,
        avgRiskScore,
      };
    } catch (err) {
      await this.db.client.attritionAnalysisRun.update({
        where: { id: run.id },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  }

  async getScores(tenantId: string, filters?: { riskLevel?: string; department?: string }) {
    const where: Record<string, unknown> = { tenantId };
    if (filters?.riskLevel) where['riskLevel'] = filters.riskLevel;
    const scores = await this.db.client.attritionRiskScore.findMany({
      where,
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            department: true,
            level: true,
            baseSalary: true,
            compaRatio: true,
          },
        },
      },
      orderBy: { riskScore: 'desc' },
    });
    let filtered = scores;
    if (filters?.department)
      filtered = scores.filter((s) => s.employee.department === filters.department);
    return filtered.map((s) => ({
      id: s.id,
      employeeId: s.employeeId,
      employeeName: `${s.employee.firstName} ${s.employee.lastName}`,
      department: s.employee.department,
      level: s.employee.level,
      baseSalary: Number(s.employee.baseSalary),
      compaRatio: s.employee.compaRatio ? Number(s.employee.compaRatio) : null,
      riskScore: s.riskScore,
      riskLevel: s.riskLevel,
      factors: s.factors,
      recommendation: s.recommendation,
      calculatedAt: s.calculatedAt,
    }));
  }

  async getEmployeeScore(tenantId: string, employeeId: string) {
    const score = await this.db.client.attritionRiskScore.findFirst({
      where: { tenantId, employeeId },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            department: true,
            level: true,
            baseSalary: true,
            compaRatio: true,
            performanceRating: true,
            hireDate: true,
          },
        },
      },
    });
    if (!score) throw new NotFoundException(`No risk score found for employee ${employeeId}`);
    return {
      ...score,
      employeeName: `${score.employee.firstName} ${score.employee.lastName}`,
      baseSalary: Number(score.employee.baseSalary),
      compaRatio: score.employee.compaRatio ? Number(score.employee.compaRatio) : null,
      performanceRating: score.employee.performanceRating
        ? Number(score.employee.performanceRating)
        : null,
      hireDate: score.employee.hireDate,
    };
  }

  async getDashboard(tenantId: string) {
    const scores = await this.db.client.attritionRiskScore.findMany({
      where: { tenantId },
      include: { employee: { select: { department: true } } },
    });
    const distribution = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    const deptRisk: Record<
      string,
      { total: number; sumScore: number; high: number; critical: number }
    > = {};
    let totalScore = 0;
    for (const s of scores) {
      distribution[s.riskLevel as keyof typeof distribution]++;
      totalScore += s.riskScore;
      const dept = s.employee.department;
      if (!deptRisk[dept]) deptRisk[dept] = { total: 0, sumScore: 0, high: 0, critical: 0 };
      deptRisk[dept]!.total++;
      deptRisk[dept]!.sumScore += s.riskScore;
      if (s.riskLevel === 'HIGH') deptRisk[dept]!.high++;
      if (s.riskLevel === 'CRITICAL') deptRisk[dept]!.critical++;
    }
    return {
      totalEmployees: scores.length,
      avgRiskScore: scores.length > 0 ? Math.round((totalScore / scores.length) * 10) / 10 : 0,
      distribution,
      departmentBreakdown: Object.entries(deptRisk)
        .map(([dept, data]) => ({
          department: dept,
          avgScore: Math.round((data.sumScore / data.total) * 10) / 10,
          total: data.total,
          high: data.high,
          critical: data.critical,
        }))
        .sort((a, b) => b.avgScore - a.avgScore),
    };
  }

  async getRuns(tenantId: string) {
    return this.db.client.attritionAnalysisRun.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
