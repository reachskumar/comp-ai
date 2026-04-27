import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@compensation/database';
import { DatabaseService } from '../../database';
import type { AuditLogQueryDto } from './dto/audit-log-query.dto';
import type { UpdateLetterSignatureDto } from './dto/update-letter-signature.dto';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Update the per-tenant letter signature. Merges into tenant.settings JSON
   * without clobbering other keys.
   */
  async updateLetterSignature(tenantId: string, dto: UpdateLetterSignatureDto) {
    const tenant = await this.db.forTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
    );
    if (!tenant) throw new NotFoundException('Tenant not found');

    const existing =
      tenant.settings && typeof tenant.settings === 'object' && !Array.isArray(tenant.settings)
        ? (tenant.settings as Record<string, unknown>)
        : {};
    const existingSig =
      existing['letterSignature'] && typeof existing['letterSignature'] === 'object'
        ? (existing['letterSignature'] as Record<string, unknown>)
        : {};

    const mergedSig: Record<string, unknown> = { ...existingSig };
    if (dto.name !== undefined) mergedSig['name'] = dto.name.trim();
    if (dto.title !== undefined) mergedSig['title'] = dto.title.trim();

    const merged: Record<string, unknown> = { ...existing, letterSignature: mergedSig };

    await this.db.forTenant(tenantId, (tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: { settings: merged as Prisma.InputJsonValue },
      }),
    );

    return { letterSignature: { name: mergedSig['name'] ?? '', title: mergedSig['title'] ?? '' } };
  }

  async getTenantInfo(tenantId: string) {
    const tenant = await this.db.forTenant(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          settings: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              users: true,
              employees: true,
            },
          },
        },
      }),
    );
    return tenant;
  }

  async listUsers(tenantId: string) {
    const users = await this.db.forTenant(tenantId, (tx) =>
      tx.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatarUrl: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return { data: users, total: users.length };
  }

  async searchEmployees(tenantId: string, search?: string, limit = 10) {
    const where: Record<string, unknown> = { tenantId };
    if (search && search.length >= 2) {
      where['OR'] = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { employeeCode: { contains: search, mode: 'insensitive' } },
        { department: { contains: search, mode: 'insensitive' } },
      ];
    }
    const data = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.findMany({
        where: where as never,
        take: Math.min(limit, 50),
        select: {
          id: true,
          firstName: true,
          lastName: true,
          department: true,
          level: true,
          employeeCode: true,
        },
        orderBy: { firstName: 'asc' },
      }),
    );
    return { data };
  }

  async listAuditLogs(tenantId: string, query: AuditLogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.action) where['action'] = query.action;
    if (query.userId) where['userId'] = query.userId;
    if (query.entityType) where['entityType'] = query.entityType;
    if (query.dateFrom || query.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (query.dateFrom) createdAt['gte'] = new Date(query.dateFrom);
      if (query.dateTo) createdAt['lte'] = new Date(query.dateTo);
      where['createdAt'] = createdAt;
    }

    const [data, total] = await this.db.forTenant(tenantId, (tx) =>
      Promise.all([
        tx.auditLog.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        }),
        tx.auditLog.count({ where }),
      ]),
    );

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Summary stats for audit logs: action counts + top active users.
   */
  async getAuditLogSummary(tenantId: string, query: { dateFrom?: string; dateTo?: string }) {
    const where: Record<string, unknown> = { tenantId };
    if (query.dateFrom || query.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (query.dateFrom) createdAt['gte'] = new Date(query.dateFrom);
      if (query.dateTo) createdAt['lte'] = new Date(query.dateTo);
      where['createdAt'] = createdAt;
    }

    const [actionCounts, userCounts, totalCount] = await this.db.forTenant(tenantId, (tx) =>
      Promise.all([
        tx.auditLog.groupBy({
          by: ['action'],
          where,
          _count: { action: true },
          orderBy: { _count: { action: 'desc' } },
        }),
        tx.auditLog.groupBy({
          by: ['userId'],
          where: { ...where, userId: { not: null } },
          _count: { userId: true },
          orderBy: { _count: { userId: 'desc' } },
          take: 5,
        }),
        tx.auditLog.count({ where }),
      ]),
    );

    // Resolve user names for top active users
    const userIds = userCounts.map((u) => u.userId).filter(Boolean) as string[];
    let userMap: Record<string, { name: string; email: string }> = {};
    if (userIds.length > 0) {
      const users = await this.db.forTenant(tenantId, (tx) =>
        tx.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        }),
      );
      userMap = Object.fromEntries(users.map((u) => [u.id, { name: u.name, email: u.email }]));
    }

    return {
      totalActions: totalCount,
      actionBreakdown: actionCounts.map((a) => ({
        action: a.action,
        count: a._count.action,
      })),
      topActiveUsers: userCounts.map((u) => ({
        userId: u.userId,
        name: userMap[u.userId!]?.name ?? 'Unknown',
        email: userMap[u.userId!]?.email ?? '',
        count: u._count.userId,
      })),
    };
  }
}
