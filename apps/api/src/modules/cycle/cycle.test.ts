import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CycleService } from './cycle.service';
import { createMockDatabaseService, TEST_TENANT_ID, TEST_USER_ID } from '../../test/setup';

interface MockLetters {
  enqueueBatch: ReturnType<typeof vi.fn>;
}

function createMockLetters(): MockLetters {
  return {
    enqueueBatch: vi.fn().mockResolvedValue({ batchId: 'batch-stub', total: 0, status: 'queued' }),
  };
}

function createCycleService() {
  const db = createMockDatabaseService();
  const letters = createMockLetters();
  const service = new (CycleService as any)(db, letters);
  return { service: service as CycleService, db, letters };
}

const MOCK_CYCLE = {
  id: 'cycle-001',
  tenantId: TEST_TENANT_ID,
  name: 'Q1 2026 Merit Cycle',
  cycleType: 'MERIT',
  status: 'DRAFT',
  budgetTotal: 500000,
  currency: 'USD',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-03-31'),
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('CycleService — createCycle', () => {
  let service: CycleService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createCycleService());
  });

  it('should create a new compensation cycle', async () => {
    db.client.compCycle.create.mockResolvedValue(MOCK_CYCLE);

    const result = await service.createCycle(TEST_TENANT_ID, {
      name: 'Q1 2026 Merit Cycle',
      cycleType: 'MERIT',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      budgetTotal: 500000,
      currency: 'USD',
    });

    expect(result).toMatchObject({ id: 'cycle-001', name: 'Q1 2026 Merit Cycle' });
    expect(db.client.compCycle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: TEST_TENANT_ID, status: 'DRAFT' }),
      }),
    );
  });
});

describe('CycleService — listCycles', () => {
  let service: CycleService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createCycleService());
  });

  it('should return paginated cycles', async () => {
    db.client.compCycle.findMany.mockResolvedValue([MOCK_CYCLE]);
    db.client.compCycle.count.mockResolvedValue(1);

    const result = await service.listCycles(TEST_TENANT_ID, { page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('should filter by status when provided', async () => {
    db.client.compCycle.findMany.mockResolvedValue([]);
    db.client.compCycle.count.mockResolvedValue(0);

    await service.listCycles(TEST_TENANT_ID, { status: 'ACTIVE', page: 1, limit: 10 });

    expect(db.client.compCycle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TEST_TENANT_ID, status: 'ACTIVE' }),
      }),
    );
  });
});

describe('CycleService — getCycle', () => {
  let service: CycleService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createCycleService());
  });

  it('should return cycle with includes', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      budgets: [],
      calibrationSessions: [],
      _count: { recommendations: 5 },
    });

    const result = await service.getCycle(TEST_TENANT_ID, 'cycle-001');

    expect(result.id).toBe('cycle-001');
    expect(result._count.recommendations).toBe(5);
  });

  it('should throw NotFoundException for non-existent cycle', async () => {
    db.client.compCycle.findFirst.mockResolvedValue(null);

    await expect(service.getCycle(TEST_TENANT_ID, 'non-existent')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('CycleService — transitionCycle', () => {
  let service: CycleService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createCycleService());
  });

  it('should transition DRAFT to PLANNING for ADMIN', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      status: 'DRAFT',
      budgets: [],
      recommendations: [],
    });
    db.client.compCycle.update.mockResolvedValue({ ...MOCK_CYCLE, status: 'PLANNING' });

    const result = await service.transitionCycle(
      TEST_TENANT_ID,
      'cycle-001',
      'PLANNING',
      'ADMIN',
      TEST_USER_ID,
    );

    expect(result.status).toBe('PLANNING');
  });

  it('should reject invalid state transition', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      status: 'DRAFT',
      budgets: [],
      recommendations: [],
    });

    await expect(
      service.transitionCycle(TEST_TENANT_ID, 'cycle-001', 'COMPLETED', 'ADMIN', TEST_USER_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject unauthorized role for transition', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      status: 'APPROVAL',
      budgets: [],
      recommendations: [{ id: 'rec-1' }],
    });

    await expect(
      service.transitionCycle(TEST_TENANT_ID, 'cycle-001', 'COMPLETED', 'VIEWER', TEST_USER_ID),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('CycleService — updateEligibility', () => {
  let service: CycleService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createCycleService());
  });

  it('persists eligibility rules under settings.eligibility, preserving other settings keys', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      status: 'PLANNING',
      settings: { foo: 'bar' },
    });
    db.client.compCycle.update.mockResolvedValue({ ...MOCK_CYCLE, status: 'PLANNING' });

    await service.updateEligibility(TEST_TENANT_ID, 'cycle-001', {
      minTenureDays: 90,
      minPerformanceRating: 3,
      departments: ['Engineering', '  '],
      excludeTerminated: true,
    });

    const updateArgs = db.client.compCycle.update.mock.calls[0]![0];
    expect(updateArgs.data.settings).toEqual({
      foo: 'bar',
      eligibility: {
        minTenureDays: 90,
        minPerformanceRating: 3,
        departments: ['Engineering'],
        excludeTerminated: true,
      },
    });
  });

  it('refuses to edit eligibility once cycle is ACTIVE', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      status: 'ACTIVE',
      settings: {},
    });
    await expect(
      service.updateEligibility(TEST_TENANT_ID, 'cycle-001', { minTenureDays: 30 }),
    ).rejects.toThrow(/DRAFT or PLANNING/);
  });
});

describe('CycleService — previewEligibility', () => {
  let service: CycleService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createCycleService());
  });

  it('returns count + sample matching the rules', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      settings: {
        eligibility: {
          minTenureDays: 90,
          departments: ['Engineering'],
          excludeTerminated: true,
        },
      },
    });
    db.client.employee.count
      .mockResolvedValueOnce(42) // eligible
      .mockResolvedValueOnce(120); // total
    db.client.employee.findMany.mockResolvedValue([
      {
        id: 'e1',
        firstName: 'Alex',
        lastName: 'Doe',
        employeeCode: 'E1',
        department: 'Engineering',
        level: 'L4',
        location: 'US',
        hireDate: new Date('2024-01-01'),
        performanceRating: 4,
        baseSalary: 150000,
        currency: 'USD',
      },
    ]);

    const result = await service.previewEligibility(TEST_TENANT_ID, 'cycle-001');

    expect(result.eligibleCount).toBe(42);
    expect(result.totalCount).toBe(120);
    expect(result.coveragePct).toBeCloseTo(35, 1);
    expect(result.sample).toHaveLength(1);
    expect(result.sample[0]?.name).toBe('Alex Doe');

    // Confirm the where clause encodes our rules.
    const findArgs = db.client.employee.findMany.mock.calls[0]![0];
    expect(findArgs.where.tenantId).toBe(TEST_TENANT_ID);
    expect(findArgs.where.department).toEqual({ in: ['Engineering'] });
    expect(findArgs.where.terminationDate).toBeNull();
    expect(findArgs.where.hireDate.lte).toBeInstanceOf(Date);
  });

  it('clamps sampleLimit between 1 and 50', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({ ...MOCK_CYCLE, settings: {} });
    db.client.employee.count.mockResolvedValue(0);
    db.client.employee.findMany.mockResolvedValue([]);

    await service.previewEligibility(TEST_TENANT_ID, 'cycle-001', { sampleLimit: 999 });
    const findArgs = db.client.employee.findMany.mock.calls[0]![0];
    expect(findArgs.take).toBe(50);
  });

  it('returns empty rules object when no eligibility configured', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({ ...MOCK_CYCLE, settings: {} });
    db.client.employee.count.mockResolvedValue(0);
    db.client.employee.findMany.mockResolvedValue([]);

    const result = await service.previewEligibility(TEST_TENANT_ID, 'cycle-001');
    expect(result.rules.departments).toEqual([]);
    expect(result.rules.excludeTerminated).toBe(true);
  });
});

describe('CycleService — closure writeback (APPROVAL → COMPLETED)', () => {
  let service: CycleService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createCycleService());
  });

  it('writes proposed salaries back to Employee.baseSalary for approved merit/promo recs', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      status: 'APPROVAL',
      budgets: [],
      recommendations: [{ id: 'rec-1' }, { id: 'rec-2' }, { id: 'rec-3' }],
    });
    db.client.compRecommendation.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        employeeId: 'emp-1',
        recType: 'MERIT_INCREASE',
        currentValue: 100000,
        proposedValue: 105000,
      },
      {
        id: 'rec-2',
        employeeId: 'emp-2',
        recType: 'PROMOTION',
        currentValue: 120000,
        proposedValue: 140000,
      },
      { id: 'rec-3', employeeId: 'emp-3', recType: 'BONUS', currentValue: 0, proposedValue: 5000 }, // skipped
    ]);
    db.client.employee.update.mockResolvedValue({});
    db.client.auditLog.create.mockResolvedValue({});
    db.client.compRecommendation.update.mockResolvedValue({});
    db.client.compCycle.update.mockResolvedValue({ ...MOCK_CYCLE, status: 'COMPLETED' });

    const result = (await service.transitionCycle(
      TEST_TENANT_ID,
      'cycle-001',
      'COMPLETED',
      'ADMIN',
      TEST_USER_ID,
    )) as { closure?: { applied: number; skipped: number } };

    expect(result.closure?.applied).toBe(2);
    expect(result.closure?.skipped).toBe(1);

    expect(db.client.employee.update).toHaveBeenCalledTimes(2);
    expect(db.client.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { baseSalary: 105000 },
    });
    expect(db.client.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-2' },
      data: { baseSalary: 140000 },
    });

    expect(db.client.auditLog.create).toHaveBeenCalledTimes(2);
    const auditCall = db.client.auditLog.create.mock.calls[0]![0];
    expect(auditCall.data.action).toBe('CYCLE_WRITEBACK');
    expect(auditCall.data.entityType).toBe('Employee');
    expect(auditCall.data.changes.from).toBe(100000);
    expect(auditCall.data.changes.to).toBe(105000);

    expect(db.client.compRecommendation.update).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      data: { status: 'APPLIED_TO_COMPPORT' },
    });
  });

  it('skips recommendations with non-positive proposed values', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      status: 'APPROVAL',
      budgets: [],
      recommendations: [{ id: 'rec-1' }],
    });
    db.client.compRecommendation.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        employeeId: 'emp-1',
        recType: 'MERIT_INCREASE',
        currentValue: 100000,
        proposedValue: 0,
      },
    ]);
    db.client.compCycle.update.mockResolvedValue({});

    const result = (await service.transitionCycle(
      TEST_TENANT_ID,
      'cycle-001',
      'COMPLETED',
      'ADMIN',
      TEST_USER_ID,
    )) as { closure?: { applied: number; skipped: number } };

    expect(result.closure?.applied).toBe(0);
    expect(result.closure?.skipped).toBe(1);
    expect(db.client.employee.update).not.toHaveBeenCalled();
  });

  it('does not run writeback for non-closure transitions', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      status: 'DRAFT',
      budgets: [],
      recommendations: [],
    });
    db.client.compCycle.update.mockResolvedValue({ ...MOCK_CYCLE, status: 'PLANNING' });

    const result = (await service.transitionCycle(
      TEST_TENANT_ID,
      'cycle-001',
      'PLANNING',
      'ADMIN',
      TEST_USER_ID,
    )) as { closure?: unknown };

    expect(result.closure).toBeUndefined();
    expect(db.client.compRecommendation.findMany).not.toHaveBeenCalled();
    expect(db.client.employee.update).not.toHaveBeenCalled();
  });
});

describe('CycleService — getMyTeamForCycle', () => {
  let service: CycleService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createCycleService());
  });

  it('returns direct reports joined with their existing recommendations and the manager budget', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      id: 'cycle-001',
      status: 'ACTIVE',
      currency: 'USD',
      name: 'FY26 Merit',
    });
    db.client.user.findFirst.mockResolvedValue({
      employeeId: 'mgr-emp-1',
      name: 'Pat Manager',
    });
    db.client.employee.findMany.mockResolvedValue([
      {
        id: 'emp-1',
        employeeCode: 'E1',
        firstName: 'Alex',
        lastName: 'Doe',
        email: 'a@x.com',
        department: 'Eng',
        level: 'L4',
        location: 'US',
        hireDate: new Date('2024-01-01'),
        baseSalary: 100000,
        totalComp: 100000,
        currency: 'USD',
        performanceRating: 4,
        compaRatio: 0.95,
        jobFamily: 'Software',
      },
      {
        id: 'emp-2',
        employeeCode: 'E2',
        firstName: 'Sam',
        lastName: 'Lee',
        email: 's@x.com',
        department: 'Eng',
        level: 'L5',
        location: 'IN',
        hireDate: new Date('2023-06-01'),
        baseSalary: 130000,
        totalComp: 130000,
        currency: 'USD',
        performanceRating: 5,
        compaRatio: 1.02,
        jobFamily: 'Software',
      },
    ]);
    db.client.compRecommendation.findMany.mockResolvedValue([
      {
        id: 'rec-1',
        employeeId: 'emp-1',
        recType: 'MERIT_INCREASE',
        currentValue: 100000,
        proposedValue: 105000,
        justification: 'Strong year',
        status: 'DRAFT',
        approvedAt: null,
      },
    ]);
    db.client.cycleBudget.findFirst.mockResolvedValue({
      department: 'Eng',
      allocated: 50000,
      spent: 5000,
      remaining: 45000,
    });

    const result = await service.getMyTeamForCycle(TEST_TENANT_ID, 'cycle-001', TEST_USER_ID);

    expect(result.managerEmployeeId).toBe('mgr-emp-1');
    expect(result.teamSize).toBe(2);
    expect(result.budget).toEqual({
      department: 'Eng',
      allocated: 50000,
      spent: 5000,
      remaining: 45000,
    });
    expect(result.members).toHaveLength(2);
    expect(result.members[0]?.employee.name).toBe('Alex Doe');
    expect(result.members[0]?.recommendation?.proposedValue).toBe(105000);
    expect(result.members[1]?.recommendation).toBeNull();

    // Confirm we filtered by managerId.
    expect(db.client.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TEST_TENANT_ID, managerId: 'mgr-emp-1' },
      }),
    );
  });

  it('returns empty members when the user has no direct reports', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      id: 'cycle-001',
      status: 'ACTIVE',
      currency: 'USD',
      name: 'FY26',
    });
    db.client.user.findFirst.mockResolvedValue({ employeeId: 'mgr-1', name: 'Pat' });
    db.client.employee.findMany.mockResolvedValue([]);
    db.client.compRecommendation.findMany.mockResolvedValue([]);
    db.client.cycleBudget.findFirst.mockResolvedValue(null);

    const result = await service.getMyTeamForCycle(TEST_TENANT_ID, 'cycle-001', TEST_USER_ID);

    expect(result.teamSize).toBe(0);
    expect(result.members).toEqual([]);
    expect(result.budget).toBeNull();
    // Skipped the recs IN-list query since there were no employees.
    expect(db.client.compRecommendation.findMany).not.toHaveBeenCalled();
  });

  it('throws when the user is not linked to an employee record', async () => {
    db.client.compCycle.findFirst.mockResolvedValue({
      id: 'cycle-001',
      status: 'ACTIVE',
      currency: 'USD',
      name: 'FY26',
    });
    db.client.user.findFirst.mockResolvedValue({ employeeId: null, name: 'Admin' });

    await expect(
      service.getMyTeamForCycle(TEST_TENANT_ID, 'cycle-001', TEST_USER_ID),
    ).rejects.toThrow(/not linked/);
  });

  it('throws NotFound for a missing cycle', async () => {
    db.client.compCycle.findFirst.mockResolvedValue(null);
    await expect(
      service.getMyTeamForCycle(TEST_TENANT_ID, 'missing', TEST_USER_ID),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('CycleService — closure-letters opt-in', () => {
  let service: CycleService;
  let db: ReturnType<typeof createMockDatabaseService>;
  let letters: MockLetters;

  beforeEach(() => {
    ({ service, db, letters } = createCycleService());
  });

  function setupApprovedCycle(
    recs: Array<{
      id: string;
      employeeId: string;
      recType: string;
      currentValue: number;
      proposedValue: number;
    }>,
  ) {
    db.client.compCycle.findFirst.mockResolvedValue({
      ...MOCK_CYCLE,
      status: 'APPROVAL',
      budgets: [],
      recommendations: recs.map((r) => ({ id: r.id })),
    });
    db.client.compRecommendation.findMany.mockResolvedValueOnce(recs);
    db.client.employee.update.mockResolvedValue({});
    db.client.auditLog.create.mockResolvedValue({});
    db.client.compRecommendation.update.mockResolvedValue({});
    db.client.compCycle.update.mockResolvedValue({ ...MOCK_CYCLE, status: 'COMPLETED' });
  }

  it('does NOT enqueue letters by default (opt-in flag is required)', async () => {
    setupApprovedCycle([
      {
        id: 'rec-1',
        employeeId: 'emp-1',
        recType: 'MERIT_INCREASE',
        currentValue: 100000,
        proposedValue: 105000,
      },
    ]);

    await service.transitionCycle(TEST_TENANT_ID, 'cycle-001', 'COMPLETED', 'ADMIN', TEST_USER_ID);

    expect(letters.enqueueBatch).not.toHaveBeenCalled();
  });

  it('enqueues one BullMQ batch per letter type when generateLetters=true', async () => {
    setupApprovedCycle([
      {
        id: 'rec-1',
        employeeId: 'emp-1',
        recType: 'MERIT_INCREASE',
        currentValue: 100000,
        proposedValue: 105000,
      },
      {
        id: 'rec-2',
        employeeId: 'emp-2',
        recType: 'PROMOTION',
        currentValue: 120000,
        proposedValue: 140000,
      },
      {
        id: 'rec-3',
        employeeId: 'emp-3',
        recType: 'ADJUSTMENT',
        currentValue: 90000,
        proposedValue: 95000,
      },
    ]);
    // Second findMany call (in enqueueClosureLetters) — return the just-applied recs.
    db.client.compRecommendation.findMany.mockResolvedValueOnce([
      {
        employeeId: 'emp-1',
        recType: 'MERIT_INCREASE',
        currentValue: 100000,
        proposedValue: 105000,
      },
      { employeeId: 'emp-2', recType: 'PROMOTION', currentValue: 120000, proposedValue: 140000 },
      { employeeId: 'emp-3', recType: 'ADJUSTMENT', currentValue: 90000, proposedValue: 95000 },
    ]);

    const result = (await service.transitionCycle(
      TEST_TENANT_ID,
      'cycle-001',
      'COMPLETED',
      'ADMIN',
      TEST_USER_ID,
      undefined,
      { generateLetters: true },
    )) as { letters?: { enqueued: number; batches: Array<{ letterType: string; total: number }> } };

    // Two batches: RAISE (merit + adjustment) and PROMOTION.
    expect(letters.enqueueBatch).toHaveBeenCalledTimes(2);
    const types = letters.enqueueBatch.mock.calls.map((c) => c[2].letterType).sort();
    expect(types).toEqual(['promotion', 'raise']);
    expect(result.letters?.enqueued).toBe(3);
    expect(result.letters?.batches).toHaveLength(2);
  });

  it('chunks employees into batches of 100', async () => {
    const employeeIds = Array.from({ length: 250 }, (_, i) => `emp-${i}`);
    setupApprovedCycle(
      employeeIds.map((employeeId, i) => ({
        id: `rec-${i}`,
        employeeId,
        recType: 'MERIT_INCREASE',
        currentValue: 100000,
        proposedValue: 105000,
      })),
    );
    db.client.compRecommendation.findMany.mockResolvedValueOnce(
      employeeIds.map((employeeId) => ({
        employeeId,
        recType: 'MERIT_INCREASE',
        currentValue: 100000,
        proposedValue: 105000,
      })),
    );

    await service.transitionCycle(
      TEST_TENANT_ID,
      'cycle-001',
      'COMPLETED',
      'ADMIN',
      TEST_USER_ID,
      undefined,
      { generateLetters: true },
    );

    // 250 → 100 + 100 + 50 across 3 batches.
    expect(letters.enqueueBatch).toHaveBeenCalledTimes(3);
    const sizes = letters.enqueueBatch.mock.calls
      .map((c) => c[2].employeeIds.length)
      .sort((a, b) => a - b);
    expect(sizes).toEqual([50, 100, 100]);
  });

  it('returns enqueue error in response without rolling back the closure', async () => {
    setupApprovedCycle([
      {
        id: 'rec-1',
        employeeId: 'emp-1',
        recType: 'MERIT_INCREASE',
        currentValue: 100000,
        proposedValue: 105000,
      },
    ]);
    db.client.compRecommendation.findMany.mockResolvedValueOnce([
      {
        employeeId: 'emp-1',
        recType: 'MERIT_INCREASE',
        currentValue: 100000,
        proposedValue: 105000,
      },
    ]);
    letters.enqueueBatch.mockRejectedValue(new Error('Redis is down'));

    const result = (await service.transitionCycle(
      TEST_TENANT_ID,
      'cycle-001',
      'COMPLETED',
      'ADMIN',
      TEST_USER_ID,
      undefined,
      { generateLetters: true },
    )) as { letters?: { error?: string }; closure?: { applied: number } };

    expect(result.letters?.error).toMatch(/Redis is down/);
    expect(result.closure?.applied).toBe(1); // writeback was NOT rolled back
  });
});
