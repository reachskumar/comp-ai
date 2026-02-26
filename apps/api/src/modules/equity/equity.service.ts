import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import type {
  CreateEquityPlanDto,
  UpdateEquityPlanDto,
  EquityPlanQueryDto,
} from './dto/equity-plan.dto';
import type {
  CreateEquityGrantDto,
  UpdateEquityGrantDto,
  EquityGrantQueryDto,
} from './dto/equity-grant.dto';

@Injectable()
export class EquityService {
  private readonly logger = new Logger(EquityService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Equity Plans ─────────────────────────────────────────────

  async listPlans(tenantId: string, query: EquityPlanQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.planType) where.planType = query.planType;
    if (query.isActive !== undefined) where.isActive = query.isActive === 'true';

    const [data, total] = await Promise.all([
      this.db.client.equityPlan.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { grants: true } } },
      }),
      this.db.client.equityPlan.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getPlan(tenantId: string, id: string) {
    const plan = await this.db.client.equityPlan.findFirst({
      where: { id, tenantId },
      include: {
        grants: {
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, department: true } },
          },
          orderBy: { grantDate: 'desc' },
        },
        _count: { select: { grants: true } },
      },
    });
    if (!plan) throw new NotFoundException('Equity plan not found');
    return plan;
  }

  async createPlan(tenantId: string, dto: CreateEquityPlanDto) {
    return this.db.client.equityPlan.create({
      data: {
        tenantId,
        name: dto.name,
        planType: dto.planType as any,
        totalSharesAuthorized: dto.totalSharesAuthorized,
        sharesAvailable: dto.totalSharesAuthorized,
        sharePrice: dto.sharePrice,
        currency: dto.currency || 'USD',
        effectiveDate: new Date(dto.effectiveDate),
        expirationDate: dto.expirationDate ? new Date(dto.expirationDate) : undefined,
        description: dto.description,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updatePlan(tenantId: string, id: string, dto: UpdateEquityPlanDto) {
    const plan = await this.db.client.equityPlan.findFirst({ where: { id, tenantId } });
    if (!plan) throw new NotFoundException('Equity plan not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.planType !== undefined) data.planType = dto.planType;
    if (dto.totalSharesAuthorized !== undefined) {
      data.totalSharesAuthorized = dto.totalSharesAuthorized;
      data.sharesAvailable = dto.totalSharesAuthorized - Number(plan.sharesIssued);
    }
    if (dto.sharePrice !== undefined) data.sharePrice = dto.sharePrice;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.effectiveDate !== undefined) data.effectiveDate = new Date(dto.effectiveDate);
    if (dto.expirationDate !== undefined) data.expirationDate = new Date(dto.expirationDate);
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.db.client.equityPlan.update({ where: { id }, data });
  }

  async deletePlan(tenantId: string, id: string) {
    const plan = await this.db.client.equityPlan.findFirst({ where: { id, tenantId } });
    if (!plan) throw new NotFoundException('Equity plan not found');
    await this.db.client.equityPlan.delete({ where: { id } });
    return { deleted: true };
  }

  // ─── Equity Grants ────────────────────────────────────────────

  async listGrants(tenantId: string, query: EquityGrantQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.planId) where.planId = query.planId;
    if (query.status) where.status = query.status;
    if (query.grantType) where.grantType = query.grantType;

    const [data, total] = await Promise.all([
      this.db.client.equityGrant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { grantDate: 'desc' },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, department: true, email: true },
          },
          plan: { select: { id: true, name: true, planType: true } },
          _count: { select: { vestingEvents: true } },
        },
      }),
      this.db.client.equityGrant.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getGrant(tenantId: string, id: string) {
    const grant = await this.db.client.equityGrant.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            department: true,
            email: true,
            level: true,
          },
        },
        plan: { select: { id: true, name: true, planType: true, sharePrice: true } },
        vestingEvents: { orderBy: { vestDate: 'asc' } },
      },
    });
    if (!grant) throw new NotFoundException('Equity grant not found');
    return grant;
  }

  async createGrant(tenantId: string, dto: CreateEquityGrantDto) {
    // Verify plan exists and has available shares
    const plan = await this.db.client.equityPlan.findFirst({
      where: { id: dto.planId, tenantId },
    });
    if (!plan) throw new NotFoundException('Equity plan not found');

    const vestingStartDate = dto.vestingStartDate
      ? new Date(dto.vestingStartDate)
      : new Date(dto.grantDate);
    const cliffMonths = dto.cliffMonths ?? 12;
    const vestingMonths = dto.vestingMonths ?? 48;

    const grant = await this.db.client.equityGrant.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        planId: dto.planId,
        grantType: dto.grantType as any,
        grantDate: new Date(dto.grantDate),
        totalShares: dto.totalShares,
        grantPrice: dto.grantPrice,
        currentPrice: dto.currentPrice ?? dto.grantPrice,
        vestingScheduleType: (dto.vestingScheduleType as any) || 'STANDARD_4Y_1Y_CLIFF',
        vestingStartDate,
        cliffMonths,
        vestingMonths,
        status: 'ACTIVE',
        expirationDate: dto.expirationDate ? new Date(dto.expirationDate) : undefined,
      },
    });

    // Auto-generate vesting events
    const events = this.generateVestingEvents(
      grant.id,
      dto.totalShares,
      vestingStartDate,
      cliffMonths,
      vestingMonths,
      dto.vestingScheduleType || 'STANDARD_4Y_1Y_CLIFF',
    );

    if (events.length > 0) {
      await this.db.client.vestingEvent.createMany({ data: events });
    }

    // Update plan shares issued/available
    await this.db.client.equityPlan.update({
      where: { id: dto.planId },
      data: {
        sharesIssued: { increment: dto.totalShares },
        sharesAvailable: { decrement: dto.totalShares },
      },
    });

    this.logger.log(`Created equity grant ${grant.id} with ${events.length} vesting events`);

    return this.getGrant(tenantId, grant.id);
  }

  async updateGrant(tenantId: string, id: string, dto: UpdateEquityGrantDto) {
    const grant = await this.db.client.equityGrant.findFirst({ where: { id, tenantId } });
    if (!grant) throw new NotFoundException('Equity grant not found');

    const data: Record<string, unknown> = {};
    if (dto.currentPrice !== undefined) data.currentPrice = dto.currentPrice;
    if (dto.grantType !== undefined) data.grantType = dto.grantType;
    if (dto.expirationDate !== undefined) data.expirationDate = new Date(dto.expirationDate);

    return this.db.client.equityGrant.update({
      where: { id },
      data,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        plan: { select: { id: true, name: true } },
      },
    });
  }

  async cancelGrant(tenantId: string, id: string) {
    const grant = await this.db.client.equityGrant.findFirst({ where: { id, tenantId } });
    if (!grant) throw new NotFoundException('Equity grant not found');

    await this.db.client.$transaction([
      this.db.client.equityGrant.update({
        where: { id },
        data: { status: 'CANCELLED' },
      }),
      this.db.client.vestingEvent.updateMany({
        where: { grantId: id, status: 'SCHEDULED' },
        data: { status: 'CANCELLED' },
      }),
      this.db.client.equityPlan.update({
        where: { id: grant.planId },
        data: {
          sharesIssued: { decrement: grant.totalShares - grant.vestedShares },
          sharesAvailable: { increment: grant.totalShares - grant.vestedShares },
        },
      }),
    ]);

    return { cancelled: true };
  }

  // ─── Employee Portfolio ───────────────────────────────────────

  async getEmployeePortfolio(tenantId: string, employeeId: string) {
    const grants = await this.db.client.equityGrant.findMany({
      where: { tenantId, employeeId },
      include: {
        plan: { select: { id: true, name: true, planType: true, sharePrice: true } },
        vestingEvents: { orderBy: { vestDate: 'asc' } },
      },
      orderBy: { grantDate: 'desc' },
    });

    let totalGrantedShares = 0;
    let totalVestedShares = 0;
    let totalUnvestedShares = 0;
    let totalCurrentValue = 0;
    let totalGrantValue = 0;

    for (const grant of grants) {
      if (grant.status === 'CANCELLED') continue;
      totalGrantedShares += grant.totalShares;
      totalVestedShares += grant.vestedShares;
      totalUnvestedShares += grant.totalShares - grant.vestedShares;
      totalCurrentValue += grant.totalShares * Number(grant.currentPrice);
      totalGrantValue += grant.totalShares * Number(grant.grantPrice);
    }

    return {
      grants,
      summary: {
        totalGrants: grants.length,
        totalGrantedShares,
        totalVestedShares,
        totalUnvestedShares,
        totalCurrentValue,
        totalGrantValue,
        totalGain: totalCurrentValue - totalGrantValue,
      },
    };
  }

  // ─── Dashboard ────────────────────────────────────────────────

  async getDashboard(tenantId: string) {
    const [plans, grants, upcomingVests] = await Promise.all([
      this.db.client.equityPlan.findMany({
        where: { tenantId, isActive: true },
        include: { _count: { select: { grants: true } } },
      }),
      this.db.client.equityGrant.findMany({
        where: { tenantId, status: { not: 'CANCELLED' } },
      }),
      this.db.client.vestingEvent.findMany({
        where: {
          grant: { tenantId },
          status: 'SCHEDULED',
          vestDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // next 90 days
          },
        },
        include: {
          grant: {
            select: {
              id: true,
              currentPrice: true,
              employee: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { vestDate: 'asc' },
        take: 20,
      }),
    ]);

    let totalSharesAuthorized = 0;
    let totalSharesIssued = 0;
    for (const plan of plans) {
      totalSharesAuthorized += plan.totalSharesAuthorized;
      totalSharesIssued += plan.sharesIssued;
    }

    let totalGrantedShares = 0;
    let totalVestedShares = 0;
    let totalCurrentValue = 0;
    for (const grant of grants) {
      totalGrantedShares += grant.totalShares;
      totalVestedShares += grant.vestedShares;
      totalCurrentValue += grant.totalShares * Number(grant.currentPrice);
    }

    return {
      plans: plans.length,
      totalSharesAuthorized,
      totalSharesIssued,
      dilutionPercent:
        totalSharesAuthorized > 0
          ? Math.round((totalSharesIssued / totalSharesAuthorized) * 10000) / 100
          : 0,
      totalGrants: grants.length,
      totalGrantedShares,
      totalVestedShares,
      totalCurrentValue,
      upcomingVests: upcomingVests.map((v) => ({
        id: v.id,
        vestDate: v.vestDate,
        sharesVested: v.sharesVested,
        estimatedValue: v.sharesVested * Number(v.grant.currentPrice),
        employeeName: `${v.grant.employee.firstName} ${v.grant.employee.lastName}`,
        grantId: v.grant.id,
      })),
    };
  }

  // ─── Vesting Event Generation ─────────────────────────────────

  private generateVestingEvents(
    grantId: string,
    totalShares: number,
    vestingStartDate: Date,
    cliffMonths: number,
    vestingMonths: number,
    scheduleType: string,
  ) {
    const events: Array<{
      grantId: string;
      vestDate: Date;
      sharesVested: number;
      cumulativeVested: number;
      status: 'SCHEDULED';
    }> = [];

    if (scheduleType === 'STANDARD_4Y_1Y_CLIFF') {
      // Standard 4-year with 1-year cliff:
      // Nothing for 12 months, then 25% cliff vest, then monthly after
      const cliffShares = Math.floor(totalShares * 0.25);
      const remainingShares = totalShares - cliffShares;
      const monthsAfterCliff = vestingMonths - cliffMonths;
      const monthlyShares =
        monthsAfterCliff > 0 ? Math.floor(remainingShares / monthsAfterCliff) : 0;

      let cumulative = 0;

      // Cliff vest
      const cliffDate = new Date(vestingStartDate);
      cliffDate.setMonth(cliffDate.getMonth() + cliffMonths);
      cumulative += cliffShares;
      events.push({
        grantId,
        vestDate: cliffDate,
        sharesVested: cliffShares,
        cumulativeVested: cumulative,
        status: 'SCHEDULED',
      });

      // Monthly vests after cliff
      let sharesAllocated = cliffShares;
      for (let m = 1; m <= monthsAfterCliff; m++) {
        const vestDate = new Date(cliffDate);
        vestDate.setMonth(vestDate.getMonth() + m);
        const isLast = m === monthsAfterCliff;
        const shares = isLast ? totalShares - sharesAllocated : monthlyShares;
        sharesAllocated += shares;
        cumulative += shares;
        events.push({
          grantId,
          vestDate,
          sharesVested: shares,
          cumulativeVested: cumulative,
          status: 'SCHEDULED',
        });
      }
    } else if (scheduleType === 'MONTHLY') {
      const monthlyShares = Math.floor(totalShares / vestingMonths);
      let cumulative = 0;
      let allocated = 0;
      for (let m = 1; m <= vestingMonths; m++) {
        const vestDate = new Date(vestingStartDate);
        vestDate.setMonth(vestDate.getMonth() + m);
        const isLast = m === vestingMonths;
        const shares = isLast ? totalShares - allocated : monthlyShares;
        allocated += shares;
        cumulative += shares;
        events.push({
          grantId,
          vestDate,
          sharesVested: shares,
          cumulativeVested: cumulative,
          status: 'SCHEDULED',
        });
      }
    } else if (scheduleType === 'QUARTERLY') {
      const quarters = Math.floor(vestingMonths / 3);
      const quarterlyShares = Math.floor(totalShares / quarters);
      let cumulative = 0;
      let allocated = 0;
      for (let q = 1; q <= quarters; q++) {
        const vestDate = new Date(vestingStartDate);
        vestDate.setMonth(vestDate.getMonth() + q * 3);
        const isLast = q === quarters;
        const shares = isLast ? totalShares - allocated : quarterlyShares;
        allocated += shares;
        cumulative += shares;
        events.push({
          grantId,
          vestDate,
          sharesVested: shares,
          cumulativeVested: cumulative,
          status: 'SCHEDULED',
        });
      }
    } else if (scheduleType === 'ANNUAL') {
      const years = Math.floor(vestingMonths / 12);
      const annualShares = Math.floor(totalShares / years);
      let cumulative = 0;
      let allocated = 0;
      for (let y = 1; y <= years; y++) {
        const vestDate = new Date(vestingStartDate);
        vestDate.setFullYear(vestDate.getFullYear() + y);
        const isLast = y === years;
        const shares = isLast ? totalShares - allocated : annualShares;
        allocated += shares;
        cumulative += shares;
        events.push({
          grantId,
          vestDate,
          sharesVested: shares,
          cumulativeVested: cumulative,
          status: 'SCHEDULED',
        });
      }
    }

    return events;
  }
}
