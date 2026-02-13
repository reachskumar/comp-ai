import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database';
import type { AuditLogQueryDto } from './dto/audit-log-query.dto';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly db: DatabaseService) {}

  async getTenantInfo(tenantId: string) {
    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
            employees: true,
          },
        },
      },
    });
    return tenant;
  }

  async listUsers(tenantId: string) {
    const users = await this.db.client.user.findMany({
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
    });
    return { data: users, total: users.length };
  }

  async listAuditLogs(tenantId: string, query: AuditLogQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.action) where['action'] = query.action;
    if (query.userId) where['userId'] = query.userId;
    if (query.entityType) where['entityType'] = query.entityType;

    const [data, total] = await Promise.all([
      this.db.client.auditLog.findMany({
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
      this.db.client.auditLog.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}

