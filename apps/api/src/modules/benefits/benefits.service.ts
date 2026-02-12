import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database';
import { EncryptionService } from './services/encryption.service';
import { PremiumCalculatorService } from './services/premium-calculator.service';
import type { CreatePlanDto, UpdatePlanDto, PlanQueryDto } from './dto/plan.dto';
import type { CreateEnrollmentDto, EnrollmentQueryDto } from './dto/enrollment.dto';
import type { CreateDependentDto, UpdateDependentDto } from './dto/dependent.dto';
import type { CreateLifeEventDto } from './dto/life-event.dto';
import type {
  CreateEnrollmentWindowDto,
  UpdateEnrollmentWindowDto,
} from './dto/enrollment-window.dto';

@Injectable()
export class BenefitsService {
  private readonly logger = new Logger(BenefitsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly encryption: EncryptionService,
    private readonly premiumCalc: PremiumCalculatorService,
  ) {}

  // ─── Plans ──────────────────────────────────────────────────────────

  async createPlan(tenantId: string, dto: CreatePlanDto) {
    return this.db.client.benefitPlan.create({
      data: {
        tenantId,
        planType: dto.planType as never,
        name: dto.name,
        carrier: dto.carrier,
        description: dto.description ?? null,
        network: dto.network ?? null,
        premiums: (dto.premiums ?? {}) as never,
        deductibles: (dto.deductibles ?? {}) as never,
        outOfPocketMax: (dto.outOfPocketMax ?? {}) as never,
        copays: (dto.copays ?? {}) as never,
        coverageDetails: (dto.coverageDetails ?? {}) as never,
        effectiveDate: new Date(dto.effectiveDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updatePlan(tenantId: string, planId: string, dto: UpdatePlanDto) {
    await this.findPlan(tenantId, planId);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name;
    if (dto.carrier !== undefined) data['carrier'] = dto.carrier;
    if (dto.planType !== undefined) data['planType'] = dto.planType;
    if (dto.description !== undefined) data['description'] = dto.description;
    if (dto.network !== undefined) data['network'] = dto.network;
    if (dto.premiums !== undefined) data['premiums'] = dto.premiums;
    if (dto.deductibles !== undefined) data['deductibles'] = dto.deductibles;
    if (dto.outOfPocketMax !== undefined) data['outOfPocketMax'] = dto.outOfPocketMax;
    if (dto.copays !== undefined) data['copays'] = dto.copays;
    if (dto.coverageDetails !== undefined) data['coverageDetails'] = dto.coverageDetails;
    if (dto.effectiveDate !== undefined) data['effectiveDate'] = new Date(dto.effectiveDate);
    if (dto.endDate !== undefined) data['endDate'] = new Date(dto.endDate);
    if (dto.isActive !== undefined) data['isActive'] = dto.isActive;

    return this.db.client.benefitPlan.update({ where: { id: planId }, data });
  }

  async listPlans(tenantId: string, query: PlanQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.planType) where['planType'] = query.planType;
    if (query.isActive !== undefined) where['isActive'] = query.isActive;

    return this.db.client.benefitPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPlan(tenantId: string, planId: string) {
    const plan = await this.findPlan(tenantId, planId);
    const premiums = (plan.premiums ?? {}) as Record<string, number>;
    const premiumBreakdown = this.premiumCalc.calculateAllTiers(premiums);
    return { ...plan, premiumBreakdown };
  }

  async deletePlan(tenantId: string, planId: string) {
    await this.findPlan(tenantId, planId);
    return this.db.client.benefitPlan.delete({ where: { id: planId } });
  }

  private async findPlan(tenantId: string, planId: string) {
    const plan = await this.db.client.benefitPlan.findFirst({
      where: { id: planId, tenantId },
    });
    if (!plan) throw new NotFoundException(`Plan ${planId} not found`);
    return plan;
  }

  // ─── Enrollments ────────────────────────────────────────────────────

  async createEnrollment(tenantId: string, dto: CreateEnrollmentDto) {
    const plan = await this.findPlan(tenantId, dto.planId);
    const premiums = (plan.premiums ?? {}) as Record<string, number>;
    const breakdown = this.premiumCalc.calculatePremium(premiums, dto.tier);

    const enrollment = await this.db.client.benefitEnrollment.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        planId: dto.planId,
        tier: dto.tier as never,
        status: 'PENDING' as never,
        effectiveDate: new Date(dto.effectiveDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        employeePremium: breakdown.employeePremium,
        employerPremium: breakdown.employerPremium,
        electedAt: new Date(),
      },
      include: { plan: true },
    });

    // Link dependents if provided
    if (dto.dependentIds?.length) {
      await this.db.client.benefitDependent.updateMany({
        where: { id: { in: dto.dependentIds }, employeeId: dto.employeeId },
        data: { enrollmentId: enrollment.id },
      });
    }

    this.logger.log(`Enrollment created: employee=${dto.employeeId} plan=${dto.planId}`);
    return enrollment;
  }

  async listEnrollments(tenantId: string, query: EnrollmentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.employeeId) where['employeeId'] = query.employeeId;
    if (query.status) where['status'] = query.status;

    const [data, total] = await Promise.all([
      this.db.client.benefitEnrollment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { plan: true, dependents: true },
      }),
      this.db.client.benefitEnrollment.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getEnrollment(tenantId: string, enrollmentId: string) {
    const enrollment = await this.db.client.benefitEnrollment.findFirst({
      where: { id: enrollmentId, tenantId },
      include: { plan: true, dependents: true },
    });
    if (!enrollment) throw new NotFoundException(`Enrollment ${enrollmentId} not found`);

    // Mask SSN on dependents for HIPAA compliance
    const maskedDependents = enrollment.dependents.map((dep) => ({
      ...dep,
      ssnEncrypted: undefined,
      ssnMasked: this.encryption.maskSsn(dep.ssnEncrypted),
    }));

    return { ...enrollment, dependents: maskedDependents };
  }

  async updateEnrollmentStatus(
    tenantId: string,
    enrollmentId: string,
    status: string,
  ) {
    const enrollment = await this.db.client.benefitEnrollment.findFirst({
      where: { id: enrollmentId, tenantId },
    });
    if (!enrollment) throw new NotFoundException(`Enrollment ${enrollmentId} not found`);

    return this.db.client.benefitEnrollment.update({
      where: { id: enrollmentId },
      data: { status: status as never },
    });
  }

  // ─── Dependents ─────────────────────────────────────────────────────

  async createDependent(tenantId: string, dto: CreateDependentDto) {
    // Encrypt SSN if provided (HIPAA: field-level encryption)
    const ssnEncrypted = dto.ssn ? this.encryption.encrypt(dto.ssn) : null;

    const dependent = await this.db.client.benefitDependent.create({
      data: {
        employeeId: dto.employeeId,
        enrollmentId: dto.enrollmentId ?? null,
        firstName: dto.firstName,
        lastName: dto.lastName,
        relationship: dto.relationship as never,
        dateOfBirth: new Date(dto.dateOfBirth),
        ssnEncrypted,
      },
    });

    this.logger.log(`Dependent created for employee=${dto.employeeId}`);
    // Return with masked SSN — never expose full SSN
    return {
      ...dependent,
      ssnEncrypted: undefined,
      ssnMasked: this.encryption.maskSsn(dependent.ssnEncrypted),
    };
  }

  async listDependents(employeeId: string) {
    const dependents = await this.db.client.benefitDependent.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });

    return dependents.map((dep) => ({
      ...dep,
      ssnEncrypted: undefined,
      ssnMasked: this.encryption.maskSsn(dep.ssnEncrypted),
    }));
  }

  async updateDependent(dependentId: string, dto: UpdateDependentDto) {
    const existing = await this.db.client.benefitDependent.findUnique({
      where: { id: dependentId },
    });
    if (!existing) throw new NotFoundException(`Dependent ${dependentId} not found`);

    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data['firstName'] = dto.firstName;
    if (dto.lastName !== undefined) data['lastName'] = dto.lastName;
    if (dto.relationship !== undefined) data['relationship'] = dto.relationship;
    if (dto.dateOfBirth !== undefined) data['dateOfBirth'] = new Date(dto.dateOfBirth);
    if (dto.ssn !== undefined) data['ssnEncrypted'] = this.encryption.encrypt(dto.ssn);

    const updated = await this.db.client.benefitDependent.update({
      where: { id: dependentId },
      data,
    });

    return {
      ...updated,
      ssnEncrypted: undefined,
      ssnMasked: this.encryption.maskSsn(updated.ssnEncrypted),
    };
  }

  async deleteDependent(dependentId: string) {
    const existing = await this.db.client.benefitDependent.findUnique({
      where: { id: dependentId },
    });
    if (!existing) throw new NotFoundException(`Dependent ${dependentId} not found`);
    return this.db.client.benefitDependent.delete({ where: { id: dependentId } });
  }

  // ─── Life Events ────────────────────────────────────────────────────

  async createLifeEvent(tenantId: string, dto: CreateLifeEventDto) {
    return this.db.client.lifeEvent.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        eventType: dto.eventType as never,
        eventDate: new Date(dto.eventDate),
        qualifyingDate: new Date(dto.qualifyingDate),
        description: dto.description ?? null,
        status: 'PENDING',
      },
    });
  }

  async listLifeEvents(tenantId: string, employeeId?: string) {
    const where: Record<string, unknown> = { tenantId };
    if (employeeId) where['employeeId'] = employeeId;

    return this.db.client.lifeEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewLifeEvent(
    tenantId: string,
    eventId: string,
    status: 'APPROVED' | 'DENIED',
    reviewerId: string,
  ) {
    const event = await this.db.client.lifeEvent.findFirst({
      where: { id: eventId, tenantId },
    });
    if (!event) throw new NotFoundException(`Life event ${eventId} not found`);

    return this.db.client.lifeEvent.update({
      where: { id: eventId },
      data: { status, reviewedBy: reviewerId, reviewedAt: new Date() },
    });
  }

  // ─── Enrollment Windows ─────────────────────────────────────────────

  async createEnrollmentWindow(tenantId: string, dto: CreateEnrollmentWindowDto) {
    return this.db.client.enrollmentWindow.create({
      data: {
        tenantId,
        name: dto.name,
        planYear: dto.planYear,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        status: 'UPCOMING' as never,
      },
    });
  }

  async listEnrollmentWindows(tenantId: string) {
    return this.db.client.enrollmentWindow.findMany({
      where: { tenantId },
      orderBy: { startDate: 'desc' },
    });
  }

  async updateEnrollmentWindow(
    tenantId: string,
    windowId: string,
    dto: UpdateEnrollmentWindowDto,
  ) {
    const existing = await this.db.client.enrollmentWindow.findFirst({
      where: { id: windowId, tenantId },
    });
    if (!existing) throw new NotFoundException(`Enrollment window ${windowId} not found`);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name;
    if (dto.planYear !== undefined) data['planYear'] = dto.planYear;
    if (dto.startDate !== undefined) data['startDate'] = new Date(dto.startDate);
    if (dto.endDate !== undefined) data['endDate'] = new Date(dto.endDate);
    if (dto.status !== undefined) data['status'] = dto.status;

    return this.db.client.enrollmentWindow.update({
      where: { id: windowId },
      data,
    });
  }

  // ─── Premium Calculator (public) ───────────────────────────────────

  async calculatePremiums(tenantId: string, planId: string, tier: string) {
    const plan = await this.findPlan(tenantId, planId);
    const premiums = (plan.premiums ?? {}) as Record<string, number>;
    const breakdown = this.premiumCalc.calculatePremium(premiums, tier);
    return {
      plan: { id: plan.id, name: plan.name, planType: plan.planType },
      ...breakdown,
      annualEmployeeCost: this.premiumCalc.calculateAnnualCost(breakdown.employeePremium),
      annualEmployerCost: this.premiumCalc.calculateAnnualCost(breakdown.employerPremium),
    };
  }
}

