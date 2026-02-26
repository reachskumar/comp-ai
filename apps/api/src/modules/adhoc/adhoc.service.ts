import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import type { CreateAdHocDto, UpdateAdHocDto } from './dto/create-adhoc.dto';
import type { AdHocQueryDto } from './dto/adhoc-query.dto';

@Injectable()
export class AdHocService {
  private readonly logger = new Logger(AdHocService.name);

  constructor(private readonly db: DatabaseService) {}

  async create(tenantId: string, userId: string, dto: CreateAdHocDto) {
    return this.db.client.adHocIncrease.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        requestedById: userId,
        type: dto.type as any,
        reason: dto.reason,
        currentValue: dto.currentValue,
        proposedValue: dto.proposedValue,
        currency: dto.currency ?? 'USD',
        effectiveDate: new Date(dto.effectiveDate),
        metadata: (dto.metadata ?? {}) as any,
      },
      include: { employee: true, requestedBy: true },
    });
  }

  async list(tenantId: string, query: AdHocQueryDto) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);
    const skip = (page - 1) * limit;

    const where: any = { tenantId };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.department) {
      where.employee = { department: query.department };
    }
    if (query.dateFrom || query.dateTo) {
      where.effectiveDate = {};
      if (query.dateFrom) where.effectiveDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.effectiveDate.lte = new Date(query.dateTo);
    }

    const [data, total] = await Promise.all([
      this.db.client.adHocIncrease.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: true,
          requestedBy: { select: { id: true, name: true, email: true } },
          approver: { select: { id: true, name: true, email: true } },
        },
      }),
      this.db.client.adHocIncrease.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getById(tenantId: string, id: string) {
    const record = await this.db.client.adHocIncrease.findFirst({
      where: { id, tenantId },
      include: {
        employee: true,
        requestedBy: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true, email: true } },
      },
    });
    if (!record) throw new NotFoundException('Ad hoc request not found');
    return record;
  }

  async update(tenantId: string, id: string, dto: UpdateAdHocDto) {
    const existing = await this.getById(tenantId, id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT requests can be updated');
    }
    const updateData: Record<string, unknown> = {};
    if (dto.type) updateData.type = dto.type;
    if (dto.reason) updateData.reason = dto.reason;
    if (dto.currentValue !== undefined) updateData.currentValue = dto.currentValue;
    if (dto.proposedValue !== undefined) updateData.proposedValue = dto.proposedValue;
    if (dto.currency) updateData.currency = dto.currency;
    if (dto.effectiveDate) updateData.effectiveDate = new Date(dto.effectiveDate);
    if (dto.metadata) updateData.metadata = dto.metadata;
    if (dto.employeeId) {
      updateData.employee = { connect: { id: dto.employeeId } };
    }

    return this.db.client.adHocIncrease.update({
      where: { id },
      data: updateData as any,
      include: { employee: true, requestedBy: true },
    });
  }

  async submit(tenantId: string, id: string) {
    const existing = await this.getById(tenantId, id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT requests can be submitted');
    }
    return this.db.client.adHocIncrease.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
      include: { employee: true },
    });
  }

  async approve(tenantId: string, id: string, userId: string) {
    const existing = await this.getById(tenantId, id);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL requests can be approved');
    }
    return this.db.client.adHocIncrease.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approverUserId: userId,
        approvedAt: new Date(),
      },
      include: { employee: true },
    });
  }

  async reject(tenantId: string, id: string, userId: string, reason?: string) {
    const existing = await this.getById(tenantId, id);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL requests can be rejected');
    }
    return this.db.client.adHocIncrease.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approverUserId: userId,
        rejectionReason: reason,
      },
      include: { employee: true },
    });
  }

  async apply(tenantId: string, id: string) {
    const existing = await this.getById(tenantId, id);
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED requests can be applied');
    }

    // Apply the change to the employee record in a transaction
    return this.db.client.$transaction(async (tx) => {
      // Update employee baseSalary and totalComp
      await tx.employee.update({
        where: { id: existing.employeeId },
        data: {
          baseSalary: existing.proposedValue,
          totalComp: existing.proposedValue,
        },
      });

      // Mark the ad hoc request as applied
      return tx.adHocIncrease.update({
        where: { id },
        data: {
          status: 'APPLIED',
          appliedAt: new Date(),
        },
        include: { employee: true },
      });
    });
  }

  async getStats(tenantId: string) {
    const [pending, approvedThisMonth, byType, totalAmount] = await Promise.all([
      this.db.client.adHocIncrease.count({
        where: { tenantId, status: 'PENDING_APPROVAL' },
      }),
      this.db.client.adHocIncrease.count({
        where: {
          tenantId,
          status: { in: ['APPROVED', 'APPLIED'] },
          approvedAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      this.db.client.adHocIncrease.groupBy({
        by: ['type'],
        where: { tenantId },
        _count: { id: true },
      }),
      this.db.client.adHocIncrease.aggregate({
        where: { tenantId, status: { in: ['APPROVED', 'APPLIED'] } },
        _sum: { proposedValue: true },
      }),
    ]);

    return {
      pendingCount: pending,
      approvedThisMonth,
      totalApprovedAmount: totalAmount._sum.proposedValue ?? 0,
      byType: byType.map((t) => ({ type: t.type, count: t._count.id })),
    };
  }
}
