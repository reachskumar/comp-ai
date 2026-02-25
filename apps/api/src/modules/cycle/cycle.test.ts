import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { CycleService } from './cycle.service';
import {
  createMockDatabaseService,
  TEST_TENANT_ID,
} from '../../test/setup';

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

    await expect(
      service.getCycle(TEST_TENANT_ID, 'non-existent'),
    ).rejects.toThrow(NotFoundException);
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
      TEST_TENANT_ID, 'cycle-001', 'PLANNING', 'ADMIN',
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
      service.transitionCycle(TEST_TENANT_ID, 'cycle-001', 'COMPLETED', 'ADMIN'),
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
      service.transitionCycle(TEST_TENANT_ID, 'cycle-001', 'COMPLETED', 'VIEWER'),
    ).rejects.toThrow(ForbiddenException);
  });
});

