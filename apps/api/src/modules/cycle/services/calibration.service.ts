import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DatabaseService } from '../../../database';
import type {
  CreateCalibrationSessionDto,
  UpdateCalibrationSessionDto,
  CalibrationQueryDto,
} from '../dto/calibration.dto';

/** Status value used to lock recommendations during calibration */
const LOCKED_STATUS = 'ESCALATED';

@Injectable()
export class CalibrationService {
  private readonly logger = new Logger(CalibrationService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Session CRUD ──────────────────────────────────────────────────────

  /**
   * Create a calibration session scoped to a department/level/group.
   * Loads matching recommendations as participants.
   */
  async createSession(
    tenantId: string,
    cycleId: string,
    userId: string,
    dto: CreateCalibrationSessionDto,
  ) {
    await this.findCycleOrThrow(tenantId, cycleId);

    // Build participant filter
    const recWhere: Record<string, unknown> = { cycleId };
    if (dto.recommendationIds && dto.recommendationIds.length > 0) {
      recWhere['id'] = { in: dto.recommendationIds };
    } else {
      const employeeFilter: Record<string, unknown> = {};
      if (dto.department) employeeFilter['department'] = dto.department;
      if (dto.level) employeeFilter['level'] = dto.level;
      if (Object.keys(employeeFilter).length > 0) {
        recWhere['employee'] = employeeFilter;
      }
    }

    // Load matching recommendations
    const recommendations = await this.db.client.compRecommendation.findMany({
      where: recWhere,
      select: {
        id: true,
        employeeId: true,
        recType: true,
        currentValue: true,
        proposedValue: true,
        status: true,
      },
    });

    if (recommendations.length === 0) {
      throw new BadRequestException(
        'No recommendations found matching the criteria',
      );
    }

    // Build participants JSON
    const participants = recommendations.map((rec) => ({
      recommendationId: rec.id,
      employeeId: rec.employeeId,
      recType: rec.recType,
      currentValue: Number(rec.currentValue),
      proposedValue: Number(rec.proposedValue),
      originalStatus: rec.status,
    }));

    const session = await this.db.client.calibrationSession.create({
      data: {
        cycleId,
        name: dto.name,
        status: 'ACTIVE' as never,
        participants: participants as never,
        outcomes: {} as never,
      },
    });

    // Audit log
    await this.db.client.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'CALIBRATION_SESSION_CREATED',
        entityType: 'CalibrationSession',
        entityId: session.id,
        changes: {
          name: dto.name,
          participantCount: participants.length,
          department: dto.department ?? null,
          level: dto.level ?? null,
        } as never,
      },
    });

    this.logger.log(
      `Created calibration session ${session.id} with ${participants.length} participants`,
    );

    return session;
  }

  /**
   * List calibration sessions for a cycle.
   */
  async listSessions(
    tenantId: string,
    cycleId: string,
    query: CalibrationQueryDto,
  ) {
    await this.findCycleOrThrow(tenantId, cycleId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { cycleId };
    if (query.status) where['status'] = query.status;

    const [data, total] = await Promise.all([
      this.db.client.calibrationSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.client.calibrationSession.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Get a single calibration session with full details.
   */
  async getSession(tenantId: string, cycleId: string, sessionId: string) {
    await this.findCycleOrThrow(tenantId, cycleId);
    return this.findSessionOrThrow(cycleId, sessionId);
  }


  // ─── Lock / Unlock Recommendations ─────────────────────────────────────

  /**
   * Lock recommendations during calibration to prevent edits.
   * Sets recommendation status to ESCALATED to indicate they are locked.
   */
  async lockRecommendations(
    tenantId: string,
    cycleId: string,
    sessionId: string,
    userId: string,
  ) {
    await this.findCycleOrThrow(tenantId, cycleId);
    const session = await this.findSessionOrThrow(cycleId, sessionId);

    const participants = session.participants as Array<{ recommendationId: string }>;
    const recIds = participants.map((p) => p.recommendationId);

    if (recIds.length === 0) return { locked: 0 };

    const result = await this.db.client.compRecommendation.updateMany({
      where: {
        id: { in: recIds },
        cycleId,
        status: { in: ['DRAFT', 'SUBMITTED'] as never },
      },
      data: { status: LOCKED_STATUS as never },
    });

    await this.db.client.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'CALIBRATION_RECOMMENDATIONS_LOCKED',
        entityType: 'CalibrationSession',
        entityId: sessionId,
        changes: { lockedCount: result.count, recommendationIds: recIds } as never,
      },
    });

    this.logger.log(`Locked ${result.count} recommendations for session ${sessionId}`);
    return { locked: result.count };
  }

  /**
   * Unlock recommendations after calibration completes.
   */
  async unlockRecommendations(
    tenantId: string,
    cycleId: string,
    sessionId: string,
    userId: string,
  ) {
    await this.findCycleOrThrow(tenantId, cycleId);
    const session = await this.findSessionOrThrow(cycleId, sessionId);

    const participants = session.participants as Array<{ recommendationId: string }>;
    const recIds = participants.map((p) => p.recommendationId);

    if (recIds.length === 0) return { unlocked: 0 };

    const result = await this.db.client.compRecommendation.updateMany({
      where: {
        id: { in: recIds },
        cycleId,
        status: LOCKED_STATUS as never,
      },
      data: { status: 'SUBMITTED' as never },
    });

    await this.db.client.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'CALIBRATION_RECOMMENDATIONS_UNLOCKED',
        entityType: 'CalibrationSession',
        entityId: sessionId,
        changes: { unlockedCount: result.count, recommendationIds: recIds } as never,
      },
    });

    this.logger.log(`Unlocked ${result.count} recommendations for session ${sessionId}`);
    return { unlocked: result.count };
  }

  // ─── Update Session / Record Outcomes ──────────────────────────────────

  /**
   * Update calibration session: change status and/or record outcomes.
   */
  async updateSession(
    tenantId: string,
    cycleId: string,
    sessionId: string,
    userId: string,
    dto: UpdateCalibrationSessionDto,
  ) {
    await this.findCycleOrThrow(tenantId, cycleId);
    const session = await this.findSessionOrThrow(cycleId, sessionId);

    const sessionStatus = session.status as string;
    if (sessionStatus === 'COMPLETED' || sessionStatus === 'CANCELLED') {
      throw new BadRequestException(
        `Cannot update a ${sessionStatus.toLowerCase()} calibration session`,
      );
    }

    const updateData: Record<string, unknown> = {};

    // Process outcomes
    if (dto.outcomes && dto.outcomes.length > 0) {
      const existingOutcomes = (session.outcomes ?? {}) as Record<string, unknown>;
      const newOutcomes: Record<string, unknown> = { ...existingOutcomes };

      await this.db.client.$transaction(async (tx) => {
        for (const outcome of dto.outcomes!) {
          newOutcomes[outcome.recommendationId] = {
            adjustedValue: outcome.adjustedValue ?? null,
            rank: outcome.rank ?? null,
            notes: outcome.notes ?? null,
            recordedAt: new Date().toISOString(),
            recordedBy: userId,
          };

          if (outcome.adjustedValue !== undefined) {
            await tx.compRecommendation.update({
              where: { id: outcome.recommendationId },
              data: { proposedValue: outcome.adjustedValue },
            });
          }
        }
      });

      updateData['outcomes'] = newOutcomes as never;
    }

    // Process status change
    if (dto.status) {
      updateData['status'] = dto.status as never;

      if (dto.status === 'COMPLETED') {
        await this.unlockRecommendations(tenantId, cycleId, sessionId, userId);
      }
    }

    if (dto.metadata) {
      const existingOutcomes = (session.outcomes ?? {}) as Record<string, unknown>;
      updateData['outcomes'] = {
        ...existingOutcomes,
        ...(updateData['outcomes'] as Record<string, unknown> ?? {}),
        _metadata: dto.metadata,
      } as never;
    }

    const updated = await this.db.client.calibrationSession.update({
      where: { id: sessionId },
      data: updateData,
    });

    await this.db.client.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'CALIBRATION_SESSION_UPDATED',
        entityType: 'CalibrationSession',
        entityId: sessionId,
        changes: {
          statusChange: dto.status ?? null,
          outcomesCount: dto.outcomes?.length ?? 0,
        } as never,
      },
    });

    this.logger.log(`Updated calibration session ${sessionId}`);
    return updated;
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

  private async findSessionOrThrow(cycleId: string, sessionId: string) {
    const session = await this.db.client.calibrationSession.findFirst({
      where: { id: sessionId, cycleId },
    });
    if (!session) {
      throw new NotFoundException(`Calibration session ${sessionId} not found`);
    }
    return session;
  }
}