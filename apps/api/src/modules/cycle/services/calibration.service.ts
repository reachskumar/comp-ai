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
      throw new BadRequestException('No recommendations found matching the criteria');
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
  async listSessions(tenantId: string, cycleId: string, query: CalibrationQueryDto) {
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
  async lockRecommendations(tenantId: string, cycleId: string, sessionId: string, userId: string) {
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
        ...((updateData['outcomes'] as Record<string, unknown>) ?? {}),
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

  // ─── AI Calibration Suggestions ─────────────────────────────────────────

  /**
   * Generate AI calibration suggestions for a session.
   * Analyzes recommendations considering pay equity, retention risk,
   * budget constraints, and performance-pay alignment.
   */
  async aiSuggest(tenantId: string, cycleId: string, sessionId: string, userId: string) {
    await this.findCycleOrThrow(tenantId, cycleId);
    const session = await this.findSessionOrThrow(cycleId, sessionId);

    const participants = session.participants as Array<{
      recommendationId: string;
      employeeId: string;
      currentValue: number;
      proposedValue: number;
    }>;

    if (participants.length === 0) {
      return { suggestions: [], response: 'No participants in this session.' };
    }

    const employeeIds = participants.map((p) => p.employeeId);
    const recIds = participants.map((p) => p.recommendationId);

    // Build the DB adapter for the AI graph
    const dbAdapter = this.buildCalibrationDbAdapter(tenantId);

    const { invokeCalibrationAssistant } = await import('@compensation/ai');

    const result = await invokeCalibrationAssistant(
      { tenantId, userId, cycleId, sessionId },
      dbAdapter,
    );

    // Audit log
    await this.db.client.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'CALIBRATION_AI_SUGGEST',
        entityType: 'CalibrationSession',
        entityId: sessionId,
        changes: {
          suggestionsCount: result.suggestions.length,
          participantCount: participants.length,
        } as never,
      },
    });

    this.logger.log(
      `AI generated ${result.suggestions.length} suggestions for session ${sessionId}`,
    );

    return result;
  }

  /**
   * Apply selected AI suggestions to recommendations.
   * Updates the proposedValue on each recommendation.
   */
  async applyAiSuggestions(
    tenantId: string,
    cycleId: string,
    sessionId: string,
    userId: string,
    suggestions: Array<{ recommendationId: string; suggestedValue: number }>,
  ) {
    await this.findCycleOrThrow(tenantId, cycleId);
    await this.findSessionOrThrow(cycleId, sessionId);

    if (suggestions.length === 0) {
      throw new BadRequestException('No suggestions provided to apply');
    }

    let applied = 0;
    await this.db.client.$transaction(async (tx) => {
      for (const suggestion of suggestions) {
        await tx.compRecommendation.update({
          where: { id: suggestion.recommendationId },
          data: { proposedValue: suggestion.suggestedValue },
        });
        applied++;
      }
    });

    // Audit log
    await this.db.client.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'CALIBRATION_AI_SUGGESTIONS_APPLIED',
        entityType: 'CalibrationSession',
        entityId: sessionId,
        changes: {
          appliedCount: applied,
          suggestions: suggestions.map((s) => ({
            recommendationId: s.recommendationId,
            suggestedValue: s.suggestedValue,
          })),
        } as never,
      },
    });

    this.logger.log(`Applied ${applied} AI suggestions for session ${sessionId}`);

    return { applied };
  }

  /**
   * Build the CalibrationDbAdapter for the AI graph.
   */
  private buildCalibrationDbAdapter(tenantId: string) {
    const db = this.db;

    return {
      async getSessionRecommendations(
        _tenantId: string,
        filters: { cycleId: string; sessionId: string },
      ) {
        const session = await db.client.calibrationSession.findFirst({
          where: { id: filters.sessionId, cycleId: filters.cycleId },
        });
        if (!session) return [];

        const participants = session.participants as Array<{ recommendationId: string }>;
        const recIds = participants.map((p) => p.recommendationId);

        return db.client.compRecommendation.findMany({
          where: { id: { in: recIds } },
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                department: true,
                level: true,
                baseSalary: true,
                compaRatio: true,
                performanceRating: true,
                hireDate: true,
                location: true,
                jobFamily: true,
              },
            },
          },
        });
      },

      async getEmployeeDetails(_tenantId: string, filters: { employeeIds: string[] }) {
        return db.client.employee.findMany({
          where: { id: { in: filters.employeeIds }, tenantId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            department: true,
            level: true,
            baseSalary: true,
            compaRatio: true,
            performanceRating: true,
            hireDate: true,
            location: true,
            jobFamily: true,
            salaryBandId: true,
          },
        });
      },

      async getAttritionRiskScores(_tenantId: string, filters: { employeeIds: string[] }) {
        return db.client.attritionRiskScore.findMany({
          where: { tenantId, employeeId: { in: filters.employeeIds } },
          select: {
            employeeId: true,
            riskScore: true,
            riskLevel: true,
            factors: true,
            recommendation: true,
          },
        });
      },

      async getCycleBudget(_tenantId: string, filters: { cycleId: string; department?: string }) {
        const cycle = await db.client.compCycle.findFirst({
          where: { id: filters.cycleId, tenantId },
          select: { budgetTotal: true, currency: true },
        });

        const budgetWhere: Record<string, unknown> = { cycleId: filters.cycleId };
        if (filters.department) {
          budgetWhere['employee'] = { department: filters.department };
        }

        const totalSpend = await db.client.compRecommendation.aggregate({
          where: budgetWhere,
          _sum: { proposedValue: true },
        });

        return {
          budgetTotal: cycle ? Number(cycle.budgetTotal) : 0,
          currency: cycle?.currency ?? 'USD',
          totalProposed: Number(totalSpend._sum.proposedValue ?? 0),
          remaining: cycle
            ? Number(cycle.budgetTotal) - Number(totalSpend._sum.proposedValue ?? 0)
            : 0,
        };
      },

      async getDepartmentStats(
        _tenantId: string,
        filters: { department: string; cycleId: string },
      ) {
        const employees = await db.client.employee.findMany({
          where: { tenantId, department: filters.department, terminationDate: null },
          select: {
            id: true,
            baseSalary: true,
            level: true,
            compaRatio: true,
            performanceRating: true,
          },
        });

        const recs = await db.client.compRecommendation.findMany({
          where: { cycleId: filters.cycleId, employee: { department: filters.department } },
          select: { currentValue: true, proposedValue: true },
        });

        const salaries = employees.map((e) => Number(e.baseSalary));
        const avgSalary =
          salaries.length > 0 ? salaries.reduce((a, b) => a + b, 0) / salaries.length : 0;
        const increases = recs.map((r) => {
          const current = Number(r.currentValue);
          return current > 0 ? ((Number(r.proposedValue) - current) / current) * 100 : 0;
        });
        const medianIncrease =
          increases.length > 0
            ? increases.sort((a, b) => a - b)[Math.floor(increases.length / 2)]
            : 0;

        const levelCounts: Record<string, number> = {};
        for (const emp of employees) {
          levelCounts[emp.level] = (levelCounts[emp.level] ?? 0) + 1;
        }

        return {
          department: filters.department,
          headcount: employees.length,
          avgSalary,
          medianIncrease,
          levelBreakdown: levelCounts,
          recommendationCount: recs.length,
        };
      },
    };
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
