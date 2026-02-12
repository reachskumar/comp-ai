import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../../database';
import type { CreateCycleDto, UpdateCycleDto } from './dto/create-cycle.dto';
import type { BulkSetBudgetDto, SetBudgetDto } from './dto/budget.dto';
import type {
  BulkCreateRecommendationDto,
  CreateRecommendationDto,
} from './dto/recommendation.dto';
import type { CycleQueryDto, RecommendationQueryDto } from './dto/cycle-query.dto';

// ─── State Machine ──────────────────────────────────────────────────────────

/**
 * Valid state transitions for CycleStatus.
 * Key = current status, Value = array of allowed target statuses.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PLANNING', 'CANCELLED'],
  PLANNING: ['ACTIVE', 'DRAFT', 'CANCELLED'],
  ACTIVE: ['CALIBRATION', 'APPROVAL', 'CANCELLED'],
  CALIBRATION: ['APPROVAL', 'ACTIVE', 'CANCELLED'],
  APPROVAL: ['COMPLETED', 'CALIBRATION', 'CANCELLED'],
  COMPLETED: [], // terminal state
  CANCELLED: [], // terminal state
};

/**
 * Roles allowed to trigger each transition.
 * If a transition is not listed, any authenticated user can trigger it.
 */
const TRANSITION_GUARDS: Record<string, string[]> = {
  'DRAFT->PLANNING': ['ADMIN', 'HR_MANAGER'],
  'PLANNING->ACTIVE': ['ADMIN', 'HR_MANAGER'],
  'ACTIVE->CALIBRATION': ['ADMIN', 'HR_MANAGER'],
  'CALIBRATION->APPROVAL': ['ADMIN', 'HR_MANAGER'],
  'APPROVAL->COMPLETED': ['ADMIN'],
  'ACTIVE->CANCELLED': ['ADMIN'],
  'PLANNING->CANCELLED': ['ADMIN'],
  'DRAFT->CANCELLED': ['ADMIN', 'HR_MANAGER'],
  'CALIBRATION->CANCELLED': ['ADMIN'],
  'APPROVAL->CANCELLED': ['ADMIN'],
};

/**
 * Validation rules that must pass before a transition is allowed.
 */
type TransitionValidator = (cycle: {
  id: string;
  budgetTotal: unknown;
  budgets: { allocated: unknown }[];
  recommendations: { id: string }[];
}) => string | null;

const TRANSITION_VALIDATORS: Record<string, TransitionValidator> = {
  'PLANNING->ACTIVE': (cycle) => {
    if (Number(cycle.budgetTotal) <= 0) {
      return 'Budget total must be set before activating the cycle';
    }
    return null;
  },
  'ACTIVE->CALIBRATION': (cycle) => {
    if (cycle.recommendations.length === 0) {
      return 'At least one recommendation must exist before calibration';
    }
    return null;
  },
  'APPROVAL->COMPLETED': (cycle) => {
    if (cycle.recommendations.length === 0) {
      return 'Cannot complete a cycle with no recommendations';
    }
    return null;
  },
};

// Batch size for bulk operations
const BULK_BATCH_SIZE = 500;

@Injectable()
export class CycleService {
  private readonly logger = new Logger(CycleService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Cycle CRUD ─────────────────────────────────────────────────────────

  async createCycle(tenantId: string, dto: CreateCycleDto) {
    return this.db.client.compCycle.create({
      data: {
        tenantId,
        name: dto.name,
        cycleType: dto.cycleType as never,
        budgetTotal: dto.budgetTotal ?? 0,
        currency: dto.currency ?? 'USD',
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        settings: (dto.settings ?? {}) as never,
        status: 'DRAFT',
      },
    });
  }

  async updateCycle(tenantId: string, cycleId: string, dto: UpdateCycleDto) {
    await this.findCycle(tenantId, cycleId);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data['name'] = dto.name;
    if (dto.cycleType !== undefined) data['cycleType'] = dto.cycleType;
    if (dto.budgetTotal !== undefined) data['budgetTotal'] = dto.budgetTotal;
    if (dto.currency !== undefined) data['currency'] = dto.currency;
    if (dto.startDate !== undefined) data['startDate'] = new Date(dto.startDate);
    if (dto.endDate !== undefined) data['endDate'] = new Date(dto.endDate);
    if (dto.settings !== undefined) data['settings'] = dto.settings;

    return this.db.client.compCycle.update({
      where: { id: cycleId },
      data,
    });
  }

  async getCycle(tenantId: string, cycleId: string) {
    const cycle = await this.db.client.compCycle.findFirst({
      where: { id: cycleId, tenantId },
      include: {
        budgets: true,
        calibrationSessions: true,
        _count: { select: { recommendations: true } },
      },
    });

    if (!cycle) {
      throw new NotFoundException(`Cycle ${cycleId} not found`);
    }

    return cycle;
  }

  async listCycles(tenantId: string, query: CycleQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };
    if (query.status) where['status'] = query.status;
    if (query.cycleType) where['cycleType'] = query.cycleType;

    const [data, total] = await Promise.all([
      this.db.client.compCycle.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { recommendations: true, budgets: true } },
        },
      }),
      this.db.client.compCycle.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── State Machine ──────────────────────────────────────────────────────

  async transitionCycle(
    tenantId: string,
    cycleId: string,
    targetStatus: string,
    userRole: string,
    reason?: string,
  ) {
    const cycle = await this.db.client.compCycle.findFirst({
      where: { id: cycleId, tenantId },
      include: {
        budgets: { select: { allocated: true } },
        recommendations: { select: { id: true } },
      },
    });

    if (!cycle) {
      throw new NotFoundException(`Cycle ${cycleId} not found`);
    }

    const currentStatus = cycle.status as string;

    // 1. Check if transition is valid
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(targetStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${currentStatus} to ${targetStatus}. Allowed: ${allowed.join(', ') || 'none (terminal state)'}`,
      );
    }

    // 2. Check role guard
    const guardKey = `${currentStatus}->${targetStatus}`;
    const allowedRoles = TRANSITION_GUARDS[guardKey];
    if (allowedRoles && !allowedRoles.includes(userRole)) {
      throw new ForbiddenException(
        `Role ${userRole} is not allowed to transition from ${currentStatus} to ${targetStatus}`,
      );
    }

    // 3. Run transition validators
    const validator = TRANSITION_VALIDATORS[guardKey];
    if (validator) {
      const error = validator(cycle as never);
      if (error) {
        throw new BadRequestException(error);
      }
    }

    // 4. Execute transition
    const updated = await this.db.client.compCycle.update({
      where: { id: cycleId },
      data: {
        status: targetStatus as never,
        settings: ({
          ...(typeof cycle.settings === 'object' && cycle.settings !== null ? cycle.settings as Record<string, unknown> : {}),
          lastTransition: {
            from: currentStatus,
            to: targetStatus,
            reason,
            at: new Date().toISOString(),
          },
        }) as never,
      },
    });

    this.logger.log(`Cycle ${cycleId} transitioned: ${currentStatus} -> ${targetStatus}`);
    return updated;
  }

  // ─── Budget Allocation ──────────────────────────────────────────────────

  /**
   * Top-down budget allocation: set department budgets from the total.
   */
  async setBudgets(tenantId: string, cycleId: string, dto: BulkSetBudgetDto) {
    await this.findCycle(tenantId, cycleId);

    const results = [];
    for (const budget of dto.budgets) {
      const result = await this.upsertBudget(cycleId, budget);
      results.push(result);
    }

    // Recalculate remaining for all budgets
    await this.recalculateBudgetRemaining(cycleId);

    return { cycleId, budgets: results };
  }

  /**
   * Bottom-up budget: manager requests a budget amount.
   * Stored as allocated; drift is calculated against cycle total.
   */
  async requestBudget(tenantId: string, cycleId: string, dto: SetBudgetDto) {
    await this.findCycle(tenantId, cycleId);
    const result = await this.upsertBudget(cycleId, dto);
    await this.recalculateBudgetRemaining(cycleId);
    return result;
  }

  private async upsertBudget(cycleId: string, dto: SetBudgetDto) {
    const existing = await this.db.client.cycleBudget.findFirst({
      where: {
        cycleId,
        department: dto.department,
        ...(dto.managerId ? { managerId: dto.managerId } : {}),
      },
    });

    if (existing) {
      return this.db.client.cycleBudget.update({
        where: { id: existing.id },
        data: {
          allocated: dto.allocated,
          remaining: dto.allocated - Number(existing.spent),
        },
      });
    }

    return this.db.client.cycleBudget.create({
      data: {
        cycleId,
        department: dto.department,
        managerId: dto.managerId ?? null,
        allocated: dto.allocated,
        spent: 0,
        remaining: dto.allocated,
        driftPct: 0,
      },
    });
  }

  private async recalculateBudgetRemaining(cycleId: string) {
    const budgets = await this.db.client.cycleBudget.findMany({
      where: { cycleId },
    });

    const cycle = await this.db.client.compCycle.findUnique({
      where: { id: cycleId },
    });

    const totalAllocated = budgets.reduce((sum, b) => sum + Number(b.allocated), 0);
    const cycleBudget = Number(cycle?.budgetTotal ?? 0);

    for (const budget of budgets) {
      const allocated = Number(budget.allocated);
      const spent = Number(budget.spent);
      const remaining = allocated - spent;
      const driftPct = cycleBudget > 0
        ? ((totalAllocated - cycleBudget) / cycleBudget) * 100
        : 0;

      await this.db.client.cycleBudget.update({
        where: { id: budget.id },
        data: {
          remaining,
          driftPct: Math.round(driftPct * 100) / 100,
        },
      });
    }
  }

  // ─── Recommendations ─────────────────────────────────────────────────

  /**
   * Bulk create/update recommendations. Processes in batches for 10k+ support.
   */
  async bulkCreateRecommendations(
    tenantId: string,
    cycleId: string,
    dto: BulkCreateRecommendationDto,
  ) {
    await this.findCycle(tenantId, cycleId);

    let created = 0;
    let updated = 0;

    // Process in batches
    for (let i = 0; i < dto.recommendations.length; i += BULK_BATCH_SIZE) {
      const batch = dto.recommendations.slice(i, i + BULK_BATCH_SIZE);

      const operations = batch.map((rec) =>
        this.upsertRecommendation(cycleId, rec),
      );

      const results = await Promise.all(operations);
      for (const result of results) {
        if (result.isNew) created++;
        else updated++;
      }
    }

    // Recalculate budget spent amounts
    await this.recalculateBudgetSpent(cycleId);

    return { cycleId, created, updated, total: created + updated };
  }

  private async upsertRecommendation(
    cycleId: string,
    rec: CreateRecommendationDto,
  ): Promise<{ isNew: boolean }> {
    const existing = await this.db.client.compRecommendation.findFirst({
      where: {
        cycleId,
        employeeId: rec.employeeId,
        recType: rec.recType as never,
      },
    });

    if (existing) {
      await this.db.client.compRecommendation.update({
        where: { id: existing.id },
        data: {
          currentValue: rec.currentValue,
          proposedValue: rec.proposedValue,
          justification: rec.justification ?? existing.justification,
          approverUserId: rec.approverUserId ?? existing.approverUserId,
        },
      });
      return { isNew: false };
    }

    await this.db.client.compRecommendation.create({
      data: {
        cycleId,
        employeeId: rec.employeeId,
        recType: rec.recType as never,
        currentValue: rec.currentValue,
        proposedValue: rec.proposedValue,
        justification: rec.justification ?? null,
        status: 'DRAFT',
        approverUserId: rec.approverUserId ?? null,
      },
    });
    return { isNew: true };
  }

  async listRecommendations(
    tenantId: string,
    cycleId: string,
    query: RecommendationQueryDto,
  ) {
    await this.findCycle(tenantId, cycleId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // Build where clause with optional filters
    const where: Record<string, unknown> = { cycleId };
    if (query.status) where['status'] = query.status;
    if (query.recType) where['recType'] = query.recType;

    // Department and level filters require joining through employee
    const employeeWhere: Record<string, unknown> = {};
    if (query.department) employeeWhere['department'] = query.department;
    if (query.level) employeeWhere['level'] = query.level;
    if (Object.keys(employeeWhere).length > 0) {
      where['employee'] = employeeWhere;
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
              totalComp: true,
            },
          },
        },
      }),
      this.db.client.compRecommendation.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateRecommendationStatus(
    tenantId: string,
    cycleId: string,
    recommendationId: string,
    status: string,
    approverUserId?: string,
  ) {
    await this.findCycle(tenantId, cycleId);

    const rec = await this.db.client.compRecommendation.findFirst({
      where: { id: recommendationId, cycleId },
    });

    if (!rec) {
      throw new NotFoundException(`Recommendation ${recommendationId} not found`);
    }

    const data: Record<string, unknown> = { status };
    if (status === 'APPROVED' && approverUserId) {
      data['approverUserId'] = approverUserId;
      data['approvedAt'] = new Date();
    }

    return this.db.client.compRecommendation.update({
      where: { id: recommendationId },
      data,
    });
  }

  /**
   * Recalculate spent amounts per budget based on approved recommendations.
   */
  private async recalculateBudgetSpent(cycleId: string) {
    const budgets = await this.db.client.cycleBudget.findMany({
      where: { cycleId },
    });

    for (const budget of budgets) {
      // Sum proposed values for recommendations in this department
      const recs = await this.db.client.compRecommendation.findMany({
        where: {
          cycleId,
          employee: { department: budget.department },
        },
        select: { proposedValue: true, currentValue: true },
      });

      const spent = recs.reduce(
        (sum, r) => sum + (Number(r.proposedValue) - Number(r.currentValue)),
        0,
      );

      const allocated = Number(budget.allocated);
      await this.db.client.cycleBudget.update({
        where: { id: budget.id },
        data: {
          spent: Math.max(0, spent),
          remaining: allocated - Math.max(0, spent),
        },
      });
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────

  async getCycleSummary(tenantId: string, cycleId: string) {
    const cycle = await this.db.client.compCycle.findFirst({
      where: { id: cycleId, tenantId },
      include: {
        budgets: true,
        _count: { select: { recommendations: true, calibrationSessions: true } },
      },
    });

    if (!cycle) {
      throw new NotFoundException(`Cycle ${cycleId} not found`);
    }

    // Budget stats
    const totalAllocated = cycle.budgets.reduce((sum, b) => sum + Number(b.allocated), 0);
    const totalSpent = cycle.budgets.reduce((sum, b) => sum + Number(b.spent), 0);
    const totalRemaining = cycle.budgets.reduce((sum, b) => sum + Number(b.remaining), 0);
    const budgetTotal = Number(cycle.budgetTotal);
    const overallDriftPct = budgetTotal > 0
      ? Math.round(((totalAllocated - budgetTotal) / budgetTotal) * 10000) / 100
      : 0;

    // Recommendation status breakdown
    const recStatusCounts = await this.db.client.compRecommendation.groupBy({
      by: ['status'],
      where: { cycleId },
      _count: { id: true },
    });

    const recommendationsByStatus: Record<string, number> = {};
    for (const group of recStatusCounts) {
      recommendationsByStatus[group.status] = group._count.id;
    }

    // Recommendation type breakdown
    const recTypeCounts = await this.db.client.compRecommendation.groupBy({
      by: ['recType'],
      where: { cycleId },
      _count: { id: true },
    });

    const recommendationsByType: Record<string, number> = {};
    for (const group of recTypeCounts) {
      recommendationsByType[group.recType] = group._count.id;
    }

    // Department budget breakdown
    const departmentBudgets = cycle.budgets.map((b) => ({
      department: b.department,
      allocated: Number(b.allocated),
      spent: Number(b.spent),
      remaining: Number(b.remaining),
      driftPct: Number(b.driftPct),
      utilizationPct: Number(b.allocated) > 0
        ? Math.round((Number(b.spent) / Number(b.allocated)) * 10000) / 100
        : 0,
    }));

    // Progress indicators
    const totalRecs = cycle._count.recommendations;
    const approvedRecs = recommendationsByStatus['APPROVED'] ?? 0;
    const completionPct = totalRecs > 0
      ? Math.round((approvedRecs / totalRecs) * 10000) / 100
      : 0;

    return {
      cycle: {
        id: cycle.id,
        name: cycle.name,
        cycleType: cycle.cycleType,
        status: cycle.status,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        currency: cycle.currency,
      },
      budget: {
        total: budgetTotal,
        allocated: totalAllocated,
        spent: totalSpent,
        remaining: totalRemaining,
        driftPct: overallDriftPct,
        utilizationPct: totalAllocated > 0
          ? Math.round((totalSpent / totalAllocated) * 10000) / 100
          : 0,
      },
      recommendations: {
        total: totalRecs,
        byStatus: recommendationsByStatus,
        byType: recommendationsByType,
        completionPct,
      },
      departments: departmentBudgets,
      calibrationSessions: cycle._count.calibrationSessions,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private async findCycle(tenantId: string, cycleId: string) {
    const cycle = await this.db.client.compCycle.findFirst({
      where: { id: cycleId, tenantId },
    });
    if (!cycle) {
      throw new NotFoundException(`Cycle ${cycleId} not found`);
    }
    return cycle;
  }
}
