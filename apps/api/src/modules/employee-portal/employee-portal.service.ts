import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database';

@Injectable()
export class EmployeePortalService {
  private readonly logger = new Logger(EmployeePortalService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Resolve the Employee record linked to the authenticated user (by email match). */
  private async resolveEmployee(tenantId: string, userId: string) {
    const user = await this.db.client.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    return this.db.client.employee.findFirst({
      where: { tenantId, email: user.email },
      include: { salaryBand: true },
    });
  }

  /** GET /employee-portal/me — full employee profile */
  async getMe(tenantId: string, userId: string) {
    const emp = await this.resolveEmployee(tenantId, userId);
    if (!emp) return null;

    // Benefit enrollments
    const enrollments = await this.db.client.benefitEnrollment.findMany({
      where: { tenantId, employeeId: emp.id, status: 'ACTIVE' },
      include: { plan: true },
    });
    const benefitsValue = enrollments.reduce((sum, e) => sum + Number(e.employerPremium) * 12, 0);

    // Equity grants summary
    const grants = await this.db.client.equityGrant.findMany({
      where: { tenantId, employeeId: emp.id },
      include: { plan: true },
    });
    const equityValue = grants.reduce((sum, g) => sum + g.vestedShares * Number(g.currentPrice), 0);

    const baseSalary = Number(emp.baseSalary);
    const totalComp = Number(emp.totalComp);
    const bonus = Math.max(0, totalComp - baseSalary - benefitsValue);

    return {
      employee: {
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email,
        department: emp.department,
        level: emp.level,
        jobFamily: emp.jobFamily,
        hireDate: emp.hireDate,
        performanceRating: emp.performanceRating ? Number(emp.performanceRating) : null,
        compaRatio: emp.compaRatio ? Number(emp.compaRatio) : null,
        currency: emp.currency,
      },
      compensation: {
        baseSalary: Math.round(baseSalary),
        bonus: Math.round(bonus),
        benefitsValue: Math.round(benefitsValue),
        equityValue: Math.round(equityValue),
        totalComp: Math.round(baseSalary + bonus + benefitsValue + equityValue),
      },
      bandPosition: emp.salaryBand
        ? {
            bandId: emp.salaryBand.id,
            jobFamily: emp.salaryBand.jobFamily,
            level: emp.salaryBand.level,
            p10: Number(emp.salaryBand.p10),
            p25: Number(emp.salaryBand.p25),
            p50: Number(emp.salaryBand.p50),
            p75: Number(emp.salaryBand.p75),
            p90: Number(emp.salaryBand.p90),
            currentSalary: Math.round(baseSalary),
          }
        : null,
    };
  }

  /** GET /employee-portal/me/comp-history — salary change timeline */
  async getCompHistory(tenantId: string, userId: string) {
    const emp = await this.resolveEmployee(tenantId, userId);
    if (!emp) return [];

    // Approved comp recommendations
    const recs = await this.db.client.compRecommendation.findMany({
      where: { employeeId: emp.id, status: 'APPROVED' },
      orderBy: { approvedAt: 'asc' },
      include: { cycle: { select: { name: true } } },
    });

    // Ad hoc increases
    const adhocs = await this.db.client.adHocIncrease.findMany({
      where: { tenantId, employeeId: emp.id, status: 'APPLIED' },
      orderBy: { effectiveDate: 'asc' },
    });

    const history = [
      ...recs.map((r) => ({
        id: r.id,
        date: r.approvedAt?.toISOString() ?? r.createdAt.toISOString(),
        type: 'cycle' as const,
        label: r.cycle.name,
        previousValue: Math.round(Number(r.currentValue)),
        newValue: Math.round(Number(r.proposedValue)),
        changePercent:
          Number(r.currentValue) > 0
            ? Math.round(
                ((Number(r.proposedValue) - Number(r.currentValue)) / Number(r.currentValue)) *
                  10000,
              ) / 100
            : 0,
      })),
      ...adhocs.map((a) => ({
        id: a.id,
        date: a.effectiveDate.toISOString(),
        type: 'adhoc' as const,
        label: a.reason,
        previousValue: Math.round(Number(a.currentValue)),
        newValue: Math.round(Number(a.proposedValue)),
        changePercent:
          Number(a.currentValue) > 0
            ? Math.round(
                ((Number(a.proposedValue) - Number(a.currentValue)) / Number(a.currentValue)) *
                  10000,
              ) / 100
            : 0,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return history;
  }

  /** GET /employee-portal/me/equity — equity grants with vesting */
  async getEquity(tenantId: string, userId: string) {
    const emp = await this.resolveEmployee(tenantId, userId);
    if (!emp)
      return {
        grants: [],
        summary: { totalGrants: 0, totalVested: 0, totalUnvested: 0, totalValue: 0, totalGain: 0 },
      };

    const grants = await this.db.client.equityGrant.findMany({
      where: { tenantId, employeeId: emp.id },
      include: {
        plan: { select: { name: true, planType: true } },
        vestingEvents: { orderBy: { vestDate: 'asc' } },
      },
      orderBy: { grantDate: 'desc' },
    });

    const mapped = grants.map((g) => ({
      id: g.id,
      planName: g.plan.name,
      grantType: g.grantType,
      grantDate: g.grantDate.toISOString(),
      totalShares: g.totalShares,
      vestedShares: g.vestedShares,
      unvestedShares: g.totalShares - g.vestedShares,
      grantPrice: Number(g.grantPrice),
      currentPrice: Number(g.currentPrice),
      currentValue: g.vestedShares * Number(g.currentPrice),
      gain: g.vestedShares * (Number(g.currentPrice) - Number(g.grantPrice)),
      status: g.status,
      vestingEvents: g.vestingEvents.map((v) => ({
        id: v.id,
        vestDate: v.vestDate.toISOString(),
        sharesVested: v.sharesVested,
        cumulativeVested: v.cumulativeVested,
        status: v.status,
      })),
    }));

    const summary = {
      totalGrants: mapped.length,
      totalVested: mapped.reduce((s, g) => s + g.vestedShares, 0),
      totalUnvested: mapped.reduce((s, g) => s + g.unvestedShares, 0),
      totalValue: Math.round(mapped.reduce((s, g) => s + g.currentValue, 0)),
      totalGain: Math.round(mapped.reduce((s, g) => s + g.gain, 0)),
    };

    return { grants: mapped, summary };
  }

  /** GET /employee-portal/me/benefits — active benefit enrollments */
  async getBenefits(tenantId: string, userId: string) {
    const emp = await this.resolveEmployee(tenantId, userId);
    if (!emp) return [];

    const enrollments = await this.db.client.benefitEnrollment.findMany({
      where: { tenantId, employeeId: emp.id, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { effectiveDate: 'desc' },
    });

    return enrollments.map((e) => ({
      id: e.id,
      planName: e.plan.name,
      planType: e.plan.planType,
      carrier: e.plan.carrier,
      tier: e.tier,
      employeePremium: Number(e.employeePremium),
      employerPremium: Number(e.employerPremium),
      effectiveDate: e.effectiveDate.toISOString(),
      coverageDetails: e.plan.coverageDetails,
      deductibles: e.plan.deductibles,
      copays: e.plan.copays,
    }));
  }

  /** GET /employee-portal/me/career-path — current level + next level */
  async getCareerPath(tenantId: string, userId: string) {
    const emp = await this.resolveEmployee(tenantId, userId);
    if (!emp) return null;

    // Get all salary bands for the same job family to infer career ladder
    const bands = emp.jobFamily
      ? await this.db.client.salaryBand.findMany({
          where: { tenantId, jobFamily: emp.jobFamily },
          orderBy: { p50: 'asc' },
        })
      : [];

    const currentBandIndex = bands.findIndex((b) => b.id === emp.salaryBandId);
    const nextBand =
      currentBandIndex >= 0 && currentBandIndex < bands.length - 1
        ? bands[currentBandIndex + 1]
        : null;

    return {
      currentLevel: emp.level,
      jobFamily: emp.jobFamily,
      performanceRating: emp.performanceRating ? Number(emp.performanceRating) : null,
      compaRatio: emp.compaRatio ? Number(emp.compaRatio) : null,
      hireDate: emp.hireDate.toISOString(),
      careerLadder: bands.map((b) => ({
        level: b.level,
        p50: Number(b.p50),
        isCurrent: b.id === emp.salaryBandId,
      })),
      nextLevel: nextBand ? { level: nextBand.level, p50Midpoint: Number(nextBand.p50) } : null,
    };
  }

  /** GET /employee-portal/me/documents — comp letters + reward statements */
  async getDocuments(tenantId: string, userId: string) {
    const emp = await this.resolveEmployee(tenantId, userId);
    if (!emp) return { letters: [], statements: [] };

    const letters = await this.db.client.compensationLetter.findMany({
      where: { tenantId, employeeId: emp.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        letterType: true,
        subject: true,
        status: true,
        pdfUrl: true,
        createdAt: true,
      },
    });

    const statements = await this.db.client.rewardsStatement.findMany({
      where: { tenantId, employeeId: emp.id },
      orderBy: { year: 'desc' },
      select: { id: true, year: true, status: true, pdfUrl: true, generatedAt: true },
    });

    return {
      letters: letters.map((l) => ({
        id: l.id,
        type: 'letter' as const,
        letterType: l.letterType,
        subject: l.subject,
        status: l.status,
        pdfUrl: l.pdfUrl,
        date: l.createdAt.toISOString(),
      })),
      statements: statements.map((s) => ({
        id: s.id,
        type: 'statement' as const,
        year: s.year,
        status: s.status,
        pdfUrl: s.pdfUrl,
        date: s.generatedAt.toISOString(),
      })),
    };
  }
}
