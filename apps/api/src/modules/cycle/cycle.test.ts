import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CycleService } from './cycle.service';
import { createMockDatabaseService, TEST_TENANT_ID, TEST_USER_ID } from '../../test/setup';

function createCycleService() {
  const db = createMockDatabaseService();
  const service = new (CycleService as any)(db);
  return { service: service as CycleService, db };
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
