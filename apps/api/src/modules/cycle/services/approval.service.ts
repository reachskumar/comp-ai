import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from '../../../database';
import type { BulkApprovalDto, NudgeDto, PendingApprovalQueryDto } from '../dto/approval.dto';

/** Default approval chain levels (configurable per cycle via settings.approvalChain) */
const DEFAULT_APPROVAL_CHAIN = ['MANAGER', 'HR_MANAGER', 'ADMIN'];

/** Batch size for bulk operations */
const BULK_BATCH_SIZE = 500;

/** Default escalation delay in milliseconds (3 days) */
const DEFAULT_ESCALATION_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue('cycle-processing') private readonly cycleQueue: Queue,
  ) {}

  // ─── Approval Chain Configuration ──────────────────────────────────────

  /**
   * Get the approval chain for a cycle. Falls back to default if not configured.
   */
  async getApprovalChain(cycleId: string): Promise<string[]> {
    const cycle = await this.db.client.compCycle.findUnique({
      where: { id: cycleId },
    });
    const settings = (cycle?.settings ?? {}) as Record<string, unknown>;
    const chain = settings['approvalChain'];
    if (Array.isArray(chain) && chain.length > 0) {
      return chain as string[];
    }
    return DEFAULT_APPROVAL_CHAIN;
  }

  // ─── Pending Approvals ─────────────────────────────────────────────────

  /**
   * List recommendations pending approval for the current user's role level.
   */
  async getPendingApprovals(
    tenantId: string,
    cycleId: string,
    _userId: string,
    query: PendingApprovalQueryDto,
  ) {
    await this.findCycleOrThrow(tenantId, cycleId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      cycleId,
      status: { in: ['SUBMITTED', 'ESCALATED'] },
    };

    if (query.status) {
      where['status'] = query.status;
    }

    if (query.department) {
      where['employee'] = { department: query.department };
    }

    const [data, total] = await Promise.all([
      this.db.client.compRecommendation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: true,
              level: true,
              baseSalary: true,
            },
          },
        },
      }),
      this.db.client.compRecommendation.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── Bulk Approve/Reject ───────────────────────────────────────────────

  /**
   * Bulk approve or reject recommendations using Prisma transactions.
   * Supports 1000+ recommendations via batching.
   */
  async bulkApproveReject(
    tenantId: string,
    cycleId: string,
    userId: string,
    dto: BulkApprovalDto,
  ) {
    await this.findCycleOrThrow(tenantId, cycleId);

    let approved = 0;
    let rejected = 0;
    const errors: { recommendationId: string; error: string }[] = [];

    // Process in batches within a transaction
    for (let i = 0; i < dto.decisions.length; i += BULK_BATCH_SIZE) {
      const batch = dto.decisions.slice(i, i + BULK_BATCH_SIZE);

      await this.db.client.$transaction(async (tx) => {
        for (const decision of batch) {
          const rec = await tx.compRecommendation.findFirst({
            where: { id: decision.recommendationId, cycleId },
          });

          if (!rec) {
            errors.push({
              recommendationId: decision.recommendationId,
              error: 'Recommendation not found',
            });
            continue;
          }

          // Only SUBMITTED or ESCALATED can be approved/rejected
          const recStatus = rec.status as string;
          if (recStatus !== 'SUBMITTED' && recStatus !== 'ESCALATED') {
            errors.push({
              recommendationId: decision.recommendationId,
              error: `Cannot ${decision.decision.toLowerCase()} recommendation in ${recStatus} status`,
            });
            continue;
          }

          const updateData: Record<string, unknown> = {
            status: decision.decision,
          };

          if (decision.decision === 'APPROVED') {
            updateData['approverUserId'] = userId;
            updateData['approvedAt'] = new Date();
            approved++;
          } else {
            rejected++;
          }

          await tx.compRecommendation.update({
            where: { id: decision.recommendationId },
            data: updateData,
          });

          // Audit log each decision
          await tx.auditLog.create({
            data: {
              tenantId,
              userId,
              action: `RECOMMENDATION_${decision.decision}`,
              entityType: 'CompRecommendation',
              entityId: decision.recommendationId,
              changes: {
                previousStatus: recStatus,
                newStatus: decision.decision,
                comment: decision.comment ?? null,
                overrideJustification: dto.overrideJustification ?? null,
              } as never,
            },
          });
        }
      });
    }

    this.logger.log(
      `Bulk approval for cycle ${cycleId}: ${approved} approved, ${rejected} rejected, ${errors.length} errors`,
    );

    return { cycleId, approved, rejected, errors, total: approved + rejected };
  }

  // ─── Escalation ────────────────────────────────────────────────────────

  /**
   * Schedule escalation for pending recommendations.
   * Uses BullMQ delayed jobs to auto-escalate after configured delay.
   */
  async scheduleEscalation(
    tenantId: string,
    cycleId: string,
    userId: string,
  ) {
    const cycle = await this.findCycleOrThrow(tenantId, cycleId);
    const settings = (cycle.settings ?? {}) as Record<string, unknown>;
    const delayMs = (settings['escalationDelayMs'] as number) ?? DEFAULT_ESCALATION_DELAY_MS;

    // Find all SUBMITTED recommendations that haven't been actioned
    const pendingRecs = await this.db.client.compRecommendation.findMany({
      where: { cycleId, status: 'SUBMITTED' as never },
      select: { id: true },
    });

    if (pendingRecs.length === 0) {
      return { scheduled: 0 };
    }

    // Schedule a delayed job for escalation
    await this.cycleQueue.add(
      'escalate-approvals',
      {
        tenantId,
        cycleId,
        recommendationIds: pendingRecs.map((r) => r.id),
        triggeredBy: userId,
      },
      { delay: delayMs, jobId: `escalate-${cycleId}-${Date.now()}` },
    );

    // Audit log
    await this.db.client.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'ESCALATION_SCHEDULED',
        entityType: 'CompCycle',
        entityId: cycleId,
        changes: {
          recommendationCount: pendingRecs.length,
          delayMs,
        } as never,
      },
    });

    this.logger.log(
      `Scheduled escalation for ${pendingRecs.length} recommendations in cycle ${cycleId}`,
    );

    return { scheduled: pendingRecs.length, delayMs };
  }

  /**
   * Execute escalation: mark SUBMITTED recommendations as ESCALATED.
   * Called by BullMQ processor when the delayed job fires.
   */
  async executeEscalation(
    tenantId: string,
    cycleId: string,
    recommendationIds: string[],
    triggeredBy: string,
  ) {
    let escalated = 0;

    for (let i = 0; i < recommendationIds.length; i += BULK_BATCH_SIZE) {
      const batch = recommendationIds.slice(i, i + BULK_BATCH_SIZE);

      await this.db.client.$transaction(async (tx) => {
        for (const recId of batch) {
          const rec = await tx.compRecommendation.findFirst({
            where: { id: recId, cycleId, status: 'SUBMITTED' as never },
          });

          if (!rec) continue; // Already actioned

          await tx.compRecommendation.update({
            where: { id: recId },
            data: { status: 'ESCALATED' as never },
          });

          await tx.auditLog.create({
            data: {
              tenantId,
              userId: triggeredBy,
              action: 'RECOMMENDATION_ESCALATED',
              entityType: 'CompRecommendation',
              entityId: recId,
              changes: {
                previousStatus: 'SUBMITTED',
                newStatus: 'ESCALATED',
                reason: 'Auto-escalation: not actioned within deadline',
              } as never,
            },
          });

          escalated++;
        }
      });
    }

    this.logger.log(`Escalated ${escalated} recommendations in cycle ${cycleId}`);
    return { escalated };
  }

  // ─── Nudge System ──────────────────────────────────────────────────────

  /**
   * Send nudge notifications to pending approvers.
   */
  async sendNudge(
    tenantId: string,
    cycleId: string,
    userId: string,
    dto: NudgeDto,
  ) {
    await this.findCycleOrThrow(tenantId, cycleId);

    let targetUserIds: string[] = [];

    if (dto.approverUserIds && dto.approverUserIds.length > 0) {
      targetUserIds = dto.approverUserIds;
    } else {
      // Find all unique approvers with pending recommendations
      const pendingRecs = await this.db.client.compRecommendation.findMany({
        where: {
          cycleId,
          status: { in: ['SUBMITTED', 'ESCALATED'] } as never,
          approverUserId: { not: null },
        },
        select: { approverUserId: true },
        distinct: ['approverUserId'],
      });
      targetUserIds = pendingRecs
        .map((r) => r.approverUserId)
        .filter((id): id is string => id !== null);
    }

    if (targetUserIds.length === 0) {
      return { nudged: 0 };
    }

    const cycle = await this.db.client.compCycle.findUnique({
      where: { id: cycleId },
      select: { name: true },
    });

    const defaultMessage = `You have pending approvals for cycle "${cycle?.name ?? cycleId}". Please review and take action.`;
    const message = dto.message ?? defaultMessage;

    // Create notifications for each target user
    const notifications = targetUserIds.map((targetUserId) => ({
      tenantId,
      userId: targetUserId,
      type: 'APPROVAL_NUDGE',
      title: 'Approval Reminder',
      body: message,
      metadata: { cycleId, nudgedBy: userId } as never,
    }));

    // Bulk create notifications
    const result = await this.db.client.notification.createMany({
      data: notifications,
    });

    // Audit log
    await this.db.client.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'NUDGE_SENT',
        entityType: 'CompCycle',
        entityId: cycleId,
        changes: {
          targetUserIds,
          message,
          count: result.count,
        } as never,
      },
    });

    this.logger.log(`Sent ${result.count} nudge notifications for cycle ${cycleId}`);

    return { nudged: result.count, targetUserIds };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private async findCycleOrThrow(tenantId: string, cycleId: string) {
    const cycle = await this.db.client.compCycle.findFirst({
      where: { id: cycleId, tenantId },
    });
    if (!cycle) {
      throw new NotFoundException(`Cycle ${cycleId} not found`);
    }
    return cycle;
  }
}

