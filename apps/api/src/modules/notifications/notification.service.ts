import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database';
import type { NotificationQueryDto } from './dto/notification-query.dto';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Public API for other modules ─────────────────────────────────

  /** Create a notification for a specific user */
  async notify(
    tenantId: string,
    userId: string,
    type: string,
    title: string,
    body?: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.db.client.notification.create({
      data: {
        tenantId,
        userId,
        type,
        title,
        body: body ?? null,
        metadata: (metadata ?? {}) as never,
      },
    });
  }

  /** Notify all users with a given role in a tenant */
  async notifyRole(
    tenantId: string,
    role: string,
    type: string,
    title: string,
    body?: string,
    metadata?: Record<string, unknown>,
  ) {
    const users = await this.db.client.user.findMany({
      where: { tenantId, role: role as never },
      select: { id: true },
    });

    const notifications = users.map((u) => ({
      tenantId,
      userId: u.id,
      type,
      title,
      body: body ?? null,
      metadata: (metadata ?? {}) as never,
    }));

    if (notifications.length > 0) {
      await this.db.client.notification.createMany({ data: notifications });
    }

    this.logger.log(`Sent "${type}" notification to ${notifications.length} ${role} users`);
    return { count: notifications.length };
  }

  // ─── User-facing endpoints ────────────────────────────────────────

  async list(userId: string, tenantId: string, query: NotificationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { userId, tenantId };
    if (query.type) where['type'] = query.type;
    if (query.read !== undefined) where['read'] = query.read;

    const [data, total] = await Promise.all([
      this.db.client.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.client.notification.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async unreadCount(userId: string, tenantId: string) {
    const count = await this.db.client.notification.count({
      where: { userId, tenantId, read: false },
    });
    return { count };
  }

  async markAsRead(userId: string, tenantId: string, notificationId: string) {
    const notif = await this.db.client.notification.findFirst({
      where: { id: notificationId, userId, tenantId },
    });
    if (!notif) throw new NotFoundException('Notification not found');

    return this.db.client.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  }

  async markAllAsRead(userId: string, tenantId: string) {
    const result = await this.db.client.notification.updateMany({
      where: { userId, tenantId, read: false },
      data: { read: true },
    });
    return { count: result.count };
  }

  async dismiss(userId: string, tenantId: string, notificationId: string) {
    const notif = await this.db.client.notification.findFirst({
      where: { id: notificationId, userId, tenantId },
    });
    if (!notif) throw new NotFoundException('Notification not found');

    return this.db.client.notification.delete({
      where: { id: notificationId },
    });
  }
}
