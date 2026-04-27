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
import type { CycleEligibilityDto } from './dto/eligibility.dto';
import { Prisma } from '@compensation/database';
import { LettersService } from '../letters/letters.service';
import { LetterTypeDto } from '../letters/dto/generate-letter.dto';

// ─── Eligibility helpers ───────────────────────────────────────────────────

interface EligibilityRules {
  minTenureDays?: number;
  minPerformanceRating?: number;
  departments: string[];
  locations: string[];
  levels: string[];
  excludeTerminated: boolean;
  notes?: string;
}

function readEligibilityRules(settings: Prisma.JsonValue): EligibilityRules {
  const empty: EligibilityRules = {
    departments: [],
    locations: [],
    levels: [],
    excludeTerminated: true,
  };
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return empty;
  const e = (settings as Record<string, unknown>)['eligibility'];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return empty;
  const obj = e as Record<string, unknown>;
  return {
    minTenureDays: typeof obj['minTenureDays'] === 'number' ? obj['minTenureDays'] : undefined,
    minPerformanceRating:
      typeof obj['minPerformanceRating'] === 'number' ? obj['minPerformanceRating'] : undefined,
    departments: Array.isArray(obj['departments'])
      ? (obj['departments'] as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    locations: Array.isArray(obj['locations'])
      ? (obj['locations'] as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    levels: Array.isArray(obj['levels'])
      ? (obj['levels'] as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    excludeTerminated: obj['excludeTerminated'] !== false,
    notes: typeof obj['notes'] === 'string' ? obj['notes'] : undefined,
  };
}

function buildEligibilityWhere(
  tenantId: string,
  rules: EligibilityRules,
): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = { tenantId };
  if (rules.minTenureDays !== undefined && rules.minTenureDays > 0) {
    const cutoff = new Date(Date.now() - rules.minTenureDays * 24 * 60 * 60 * 1000);
    where.hireDate = { lte: cutoff };
  }
  if (rules.minPerformanceRating !== undefined) {
    where.performanceRating = { gte: rules.minPerformanceRating };
  }
  if (rules.departments.length > 0) where.department = { in: rules.departments };
  if (rules.locations.length > 0) where.location = { in: rules.locations };
  if (rules.levels.length > 0) where.level = { in: rules.levels };
  if (rules.excludeTerminated) where.terminationDate = null;
  return where;
}

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

  constructor(
    private readonly db: DatabaseService,
    private readonly letters: LettersService,
  ) {}

  // ─── Cycle CRUD ─────────────────────────────────────────────────────────

  async createCycle(tenantId: string, dto: CreateCycleDto) {
    return this.db.forTenant(tenantId, async (tx) =>
      tx.compCycle.create({
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
      }),
    );
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

    return this.db.forTenant(tenantId, async (tx) =>
      tx.compCycle.update({
        where: { id: cycleId },
        data,
      }),
    );
  }

  async getCycle(tenantId: string, cycleId: string) {
    const cycle = await this.db.forTenant(tenantId, async (tx) =>
      tx.compCycle.findFirst({
        where: { id: cycleId, tenantId },
        include: {
          budgets: true,
          calibrationSessions: true,
          _count: { select: { recommendations: true } },
        },
      }),
    );

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

    const [data, total] = await this.db.forTenant(tenantId, async (tx) =>
      Promise.all([
        tx.compCycle.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: { select: { recommendations: true, budgets: true } },
          },
        }),
        tx.compCycle.count({ where }),
      ]),
    );

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ─── State Machine ──────────────────────────────────────────────────────

  async transitionCycle(
    tenantId: string,
    cycleId: string,
    targetStatus: string,
    userRole: string,
    userId: string,
    reason?: string,
    options?: { generateLetters?: boolean },
  ) {
    const result = await this.db.forTenant(tenantId, async (tx) => {
      const cycle = await tx.compCycle.findFirst({
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

      // 4. Closure side-effects (APPROVAL → COMPLETED only). Runs in the same
      // transaction as the status flip so a partial close is impossible.
      let closure:
        | { applied: number; skipped: number; total: number; appliedEmployeeIds: string[] }
        | undefined;
      if (currentStatus === 'APPROVAL' && targetStatus === 'COMPLETED') {
        closure = await this.applyClosureWriteback(tx, tenantId, cycleId, userId);
      }

      // 5. Execute transition
      const updated = await tx.compCycle.update({
        where: { id: cycleId },
        data: {
          status: targetStatus as never,
          settings: {
            ...(typeof cycle.settings === 'object' && cycle.settings !== null
              ? (cycle.settings as Record<string, unknown>)
              : {}),
            lastTransition: {
              from: currentStatus,
              to: targetStatus,
              reason,
              at: new Date().toISOString(),
              ...(closure ? { closure } : {}),
            },
          } as never,
        },
      });

      this.logger.log(
        `Cycle ${cycleId} transitioned: ${currentStatus} -> ${targetStatus}${closure ? ` (writeback applied=${closure.applied})` : ''}`,
      );
      return closure ? { ...updated, closure } : updated;
    });

    // Letter enqueue runs AFTER the transaction so its (potentially slow)
    // BullMQ + tenant-config lookups don't hold the cycle write open. If
    // enqueue fails the cycle is still cleanly COMPLETED — we surface the
    // error in the response but don't roll back the writeback.
    if (
      options?.generateLetters &&
      result &&
      typeof result === 'object' &&
      'closure' in result &&
      result.closure
    ) {
      const closure = result.closure as {
        appliedEmployeeIds: string[];
      };
      const lettersResult = await this.enqueueClosureLetters(tenantId, cycleId, userId).catch(
        (err: unknown) => ({
          error: err instanceof Error ? err.message : String(err),
          enqueued: 0,
          batches: [] as Array<{ batchId: string; letterType: string; total: number }>,
        }),
      );
      return {
        ...result,
        letters: {
          requested: closure.appliedEmployeeIds.length,
          ...lettersResult,
        },
      };
    }

    return result;
  }

  /**
   * Enqueue letter batches for every recommendation just written back.
   * Splits by recommendation type (one BullMQ batch per letter type) so
   * each batch's downstream prompt + UI groups cleanly.
   *
   * Read-only against the cycle/recommendations — fine to run after the
   * closure transaction commits.
   */
  private async enqueueClosureLetters(tenantId: string, cycleId: string, userId: string) {
    const recs = await this.db.forTenant(tenantId, (tx) =>
      tx.compRecommendation.findMany({
        where: { cycleId, status: 'APPLIED_TO_COMPPORT' },
        select: { employeeId: true, recType: true, proposedValue: true, currentValue: true },
      }),
    );

    // Bucket employees by the letter type their rec maps to.
    const byLetterType = new Map<LetterTypeDto, string[]>();
    for (const rec of recs) {
      const letterType = this.letterTypeForRec(rec.recType);
      if (!letterType) continue;
      const arr = byLetterType.get(letterType) ?? [];
      arr.push(rec.employeeId);
      byLetterType.set(letterType, arr);
    }

    const batches: Array<{ batchId: string; letterType: string; total: number }> = [];
    let enqueued = 0;
    for (const [letterType, employeeIds] of byLetterType) {
      // Letters batch is capped at 100 employees per BullMQ job.
      for (let i = 0; i < employeeIds.length; i += 100) {
        const chunk = employeeIds.slice(i, i + 100);
        const batch = await this.letters.enqueueBatch(tenantId, userId, {
          employeeIds: chunk,
          letterType,
        });
        batches.push({ batchId: batch.batchId, letterType, total: chunk.length });
        enqueued += chunk.length;
      }
    }

    this.logger.log(
      `Cycle ${cycleId} closure-letters: enqueued ${enqueued} across ${batches.length} batch(es)`,
    );
    return { enqueued, batches };
  }

  // ─── Budget Allocation ──────────────────────────────────────────────────

  /**
   * Top-down budget allocation: set department budgets from the total.
   */
  async setBudgets(tenantId: string, cycleId: string, dto: BulkSetBudgetDto) {
    await this.findCycle(tenantId, cycleId);

    const results = [];
    for (const budget of dto.budgets) {
      const result = await this.upsertBudget(tenantId, cycleId, budget);
      results.push(result);
    }

    // Recalculate remaining for all budgets
    await this.recalculateBudgetRemaining(tenantId, cycleId);

    return { cycleId, budgets: results };
  }

  /**
   * Bottom-up budget: manager requests a budget amount.
   * Stored as allocated; drift is calculated against cycle total.
   */
  async requestBudget(tenantId: string, cycleId: string, dto: SetBudgetDto) {
    await this.findCycle(tenantId, cycleId);
    const result = await this.upsertBudget(tenantId, cycleId, dto);
    await this.recalculateBudgetRemaining(tenantId, cycleId);
    return result;
  }

  private async upsertBudget(tenantId: string, cycleId: string, dto: SetBudgetDto) {
    return this.db.forTenant(tenantId, async (tx) => {
      const existing = await tx.cycleBudget.findFirst({
        where: {
          cycleId,
          department: dto.department,
          ...(dto.managerId ? { managerId: dto.managerId } : {}),
        },
      });

      if (existing) {
        return tx.cycleBudget.update({
          where: { id: existing.id },
          data: {
            allocated: dto.allocated,
            remaining: dto.allocated - Number(existing.spent),
          },
        });
      }

      return tx.cycleBudget.create({
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
    });
  }

  private async recalculateBudgetRemaining(tenantId: string, cycleId: string) {
    return this.db.forTenant(tenantId, async (tx) => {
      const budgets = await tx.cycleBudget.findMany({
        where: { cycleId },
      });

      const cycle = await tx.compCycle.findUnique({
        where: { id: cycleId },
      });

      const totalAllocated = budgets.reduce((sum, b) => sum + Number(b.allocated), 0);
      const cycleBudget = Number(cycle?.budgetTotal ?? 0);

      for (const budget of budgets) {
        const allocated = Number(budget.allocated);
        const spent = Number(budget.spent);
        const remaining = allocated - spent;
        const driftPct = cycleBudget > 0 ? ((totalAllocated - cycleBudget) / cycleBudget) * 100 : 0;

        await tx.cycleBudget.update({
          where: { id: budget.id },
          data: {
            remaining,
            driftPct: Math.round(driftPct * 100) / 100,
          },
        });
      }
    });
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

      const operations = batch.map((rec) => this.upsertRecommendation(tenantId, cycleId, rec));

      const results = await Promise.all(operations);
      for (const result of results) {
        if (result.isNew) created++;
        else updated++;
      }
    }

    // Recalculate budget spent amounts
    await this.recalculateBudgetSpent(tenantId, cycleId);

    return { cycleId, created, updated, total: created + updated };
  }

  private async upsertRecommendation(
    tenantId: string,
    cycleId: string,
    rec: CreateRecommendationDto,
  ): Promise<{ isNew: boolean }> {
    return this.db.forTenant(tenantId, async (tx) => {
      const existing = await tx.compRecommendation.findFirst({
        where: {
          cycleId,
          employeeId: rec.employeeId,
          recType: rec.recType as never,
        },
      });

      if (existing) {
        await tx.compRecommendation.update({
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

      await tx.compRecommendation.create({
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
    });
  }

  async listRecommendations(tenantId: string, cycleId: string, query: RecommendationQueryDto) {
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

    const [data, total] = await this.db.forTenant(tenantId, async (tx) =>
      Promise.all([
        tx.compRecommendation.findMany({
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
        tx.compRecommendation.count({ where }),
      ]),
    );

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

    return this.db.forTenant(tenantId, async (tx) => {
      const rec = await tx.compRecommendation.findFirst({
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

      return tx.compRecommendation.update({
        where: { id: recommendationId },
        data,
      });
    });
  }

  /**
   * Recalculate spent amounts per budget based on approved recommendations.
   */
  private async recalculateBudgetSpent(tenantId: string, cycleId: string) {
    return this.db.forTenant(tenantId, async (tx) => {
      const budgets = await tx.cycleBudget.findMany({
        where: { cycleId },
      });

      for (const budget of budgets) {
        // Sum proposed values for recommendations in this department
        const recs = await tx.compRecommendation.findMany({
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
        await tx.cycleBudget.update({
          where: { id: budget.id },
          data: {
            spent: Math.max(0, spent),
            remaining: allocated - Math.max(0, spent),
          },
        });
      }
    });
  }

  // ─── Summary ────────────────────────────────────────────────────────────

  async getCycleSummary(tenantId: string, cycleId: string) {
    return this.db.forTenant(tenantId, async (tx) => {
      const cycle = await tx.compCycle.findFirst({
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
      const overallDriftPct =
        budgetTotal > 0
          ? Math.round(((totalAllocated - budgetTotal) / budgetTotal) * 10000) / 100
          : 0;

      // Recommendation status breakdown
      const recStatusCounts = await tx.compRecommendation.groupBy({
        by: ['status'],
        where: { cycleId },
        _count: { id: true },
      });

      const recommendationsByStatus: Record<string, number> = {};
      for (const group of recStatusCounts) {
        recommendationsByStatus[group.status] = group._count.id;
      }

      // Recommendation type breakdown
      const recTypeCounts = await tx.compRecommendation.groupBy({
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
        utilizationPct:
          Number(b.allocated) > 0
            ? Math.round((Number(b.spent) / Number(b.allocated)) * 10000) / 100
            : 0,
      }));

      // Progress indicators
      const totalRecs = cycle._count.recommendations;
      const approvedRecs = recommendationsByStatus['APPROVED'] ?? 0;
      const completionPct =
        totalRecs > 0 ? Math.round((approvedRecs / totalRecs) * 10000) / 100 : 0;

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
          utilizationPct:
            totalAllocated > 0 ? Math.round((totalSpent / totalAllocated) * 10000) / 100 : 0,
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
    });
  }

  // ─── Eligibility ────────────────────────────────────────────────────────

  /**
   * Update the cycle's eligibility rules. Only allowed in DRAFT or PLANNING —
   * once a cycle is ACTIVE the rules are effectively snapshotted on the
   * recommendations that have been created.
   */
  async updateEligibility(tenantId: string, cycleId: string, dto: CycleEligibilityDto) {
    return this.db.forTenant(tenantId, async (tx) => {
      const cycle = await tx.compCycle.findFirst({ where: { id: cycleId, tenantId } });
      if (!cycle) throw new NotFoundException(`Cycle ${cycleId} not found`);
      if (cycle.status !== 'DRAFT' && cycle.status !== 'PLANNING') {
        throw new BadRequestException(
          `Eligibility rules can only be edited in DRAFT or PLANNING (current: ${cycle.status})`,
        );
      }

      const existingSettings =
        typeof cycle.settings === 'object' &&
        cycle.settings !== null &&
        !Array.isArray(cycle.settings)
          ? (cycle.settings as Record<string, unknown>)
          : {};

      const cleaned: Record<string, unknown> = {};
      if (dto.minTenureDays !== undefined) cleaned['minTenureDays'] = dto.minTenureDays;
      if (dto.minPerformanceRating !== undefined)
        cleaned['minPerformanceRating'] = dto.minPerformanceRating;
      if (dto.departments !== undefined)
        cleaned['departments'] = dto.departments.map((s) => s.trim()).filter(Boolean);
      if (dto.locations !== undefined)
        cleaned['locations'] = dto.locations.map((s) => s.trim()).filter(Boolean);
      if (dto.levels !== undefined)
        cleaned['levels'] = dto.levels.map((s) => s.trim()).filter(Boolean);
      if (dto.excludeTerminated !== undefined) cleaned['excludeTerminated'] = dto.excludeTerminated;
      if (dto.notes !== undefined) cleaned['notes'] = dto.notes.trim();

      const merged = {
        ...existingSettings,
        eligibility: cleaned,
      } as unknown as Prisma.InputJsonValue;

      const updated = await tx.compCycle.update({
        where: { id: cycleId },
        data: { settings: merged },
      });
      this.logger.log(`Cycle ${cycleId} eligibility updated`);
      return { cycleId, eligibility: cleaned, status: updated.status };
    });
  }

  /**
   * Evaluate eligibility against the current employee population and return a
   * count + a small sample for spot-checking before launch. Read-only — does
   * not create recommendations.
   */
  async previewEligibility(tenantId: string, cycleId: string, options?: { sampleLimit?: number }) {
    const limit = Math.max(1, Math.min(50, options?.sampleLimit ?? 10));
    return this.db.forTenant(tenantId, async (tx) => {
      const cycle = await tx.compCycle.findFirst({ where: { id: cycleId, tenantId } });
      if (!cycle) throw new NotFoundException(`Cycle ${cycleId} not found`);

      const rules = readEligibilityRules(cycle.settings);
      const where = buildEligibilityWhere(tenantId, rules);

      const [eligibleCount, totalCount, sample] = await Promise.all([
        tx.employee.count({ where }),
        tx.employee.count({ where: { tenantId } }),
        tx.employee.findMany({
          where,
          take: limit,
          orderBy: { firstName: 'asc' },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
            level: true,
            location: true,
            hireDate: true,
            performanceRating: true,
            baseSalary: true,
            currency: true,
          },
        }),
      ]);

      return {
        cycleId,
        rules,
        eligibleCount,
        totalCount,
        coveragePct: totalCount > 0 ? Math.round((eligibleCount / totalCount) * 10000) / 100 : 0,
        sample: sample.map((e) => ({
          id: e.id,
          employeeCode: e.employeeCode,
          name: `${e.firstName} ${e.lastName}`.trim(),
          department: e.department,
          level: e.level,
          location: e.location,
          hireDate: e.hireDate,
          performanceRating: e.performanceRating ? Number(e.performanceRating) : null,
          baseSalary: Number(e.baseSalary),
          currency: e.currency,
        })),
      };
    });
  }

  // ─── Closure ────────────────────────────────────────────────────────────

  /**
   * Side-effect of the APPROVAL → COMPLETED transition: for every APPROVED
   * recommendation, write the proposed value back to Employee.baseSalary
   * (for MERIT_INCREASE / ADJUSTMENT / PROMOTION) and emit an audit log entry
   * per change. Runs in a single transaction with the status flip so a
   * partial closure is impossible.
   *
   * Returns counts: { applied, skipped, failed }.
   */
  private async applyClosureWriteback(
    tx: Prisma.TransactionClient,
    tenantId: string,
    cycleId: string,
    userId: string,
  ) {
    const approved = await tx.compRecommendation.findMany({
      where: { cycleId, status: 'APPROVED' },
      select: {
        id: true,
        employeeId: true,
        recType: true,
        currentValue: true,
        proposedValue: true,
      },
    });

    let applied = 0;
    let skipped = 0;
    const appliedEmployeeIds: string[] = [];

    for (const rec of approved) {
      // Only salary-affecting types update baseSalary.
      const updatesSalary =
        rec.recType === 'MERIT_INCREASE' ||
        rec.recType === 'ADJUSTMENT' ||
        rec.recType === 'PROMOTION';
      if (!updatesSalary) {
        skipped++;
        continue;
      }
      const proposed = Number(rec.proposedValue);
      if (!Number.isFinite(proposed) || proposed <= 0) {
        skipped++;
        continue;
      }

      await tx.employee.update({
        where: { id: rec.employeeId },
        data: { baseSalary: proposed },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'CYCLE_WRITEBACK',
          entityType: 'Employee',
          entityId: rec.employeeId,
          changes: {
            cycleId,
            recommendationId: rec.id,
            recType: rec.recType,
            from: Number(rec.currentValue),
            to: proposed,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      // Mark recommendation as applied (in our internal-writeback flow).
      await tx.compRecommendation.update({
        where: { id: rec.id },
        data: { status: 'APPLIED_TO_COMPPORT' },
      });

      applied++;
      appliedEmployeeIds.push(rec.employeeId);
    }

    this.logger.log(
      `Cycle ${cycleId} closure: applied=${applied} skipped=${skipped} of ${approved.length} approved recs`,
    );
    return { applied, skipped, total: approved.length, appliedEmployeeIds };
  }

  /**
   * Map a recommendation type to the corresponding letter type. Recs that
   * don't fit any letter type return null and are skipped.
   */
  private letterTypeForRec(recType: string): LetterTypeDto | null {
    switch (recType) {
      case 'MERIT_INCREASE':
      case 'ADJUSTMENT':
        return LetterTypeDto.RAISE;
      case 'PROMOTION':
        return LetterTypeDto.PROMOTION;
      case 'BONUS':
        return LetterTypeDto.BONUS;
      default:
        return null;
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private async findCycle(tenantId: string, cycleId: string) {
    const cycle = await this.db.forTenant(tenantId, async (tx) =>
      tx.compCycle.findFirst({
        where: { id: cycleId, tenantId },
      }),
    );
    if (!cycle) {
      throw new NotFoundException(`Cycle ${cycleId} not found`);
    }
    return cycle;
  }
}
