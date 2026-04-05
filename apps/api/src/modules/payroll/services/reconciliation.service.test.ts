import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReconciliationService } from './reconciliation.service';
import {
  createMockDatabaseService,
  TEST_TENANT_ID,
} from '../../../test/setup';

// ─── Mock Dependencies ────────────────────────────────────────────────────────

function createMockAnomalyDetector() {
  return {
    detectAnomalies: vi.fn().mockResolvedValue({
      payrollRunId: 'run-1',
      totalAnomalies: 0,
      criticalCount: 0,
      highCount: 0,
      hasBlockers: false,
    }),
  };
}

function createMockTraceability() {
  return {
    traceEmployee: vi.fn().mockResolvedValue({
      payrollRunId: 'run-1',
      employeeId: 'emp-1',
      employeeName: 'Test Employee',
      period: '2026-01',
      component: null,
      generatedAt: new Date(),
      steps: [],
      summary: 'No changes',
      isComplete: true,
      warnings: [],
    }),
  };
}

function createMockQueue() {
  return {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
  };
}

function createReconciliationService() {
  const db = createMockDatabaseService();
  const anomalyDetector = createMockAnomalyDetector();
  const traceability = createMockTraceability();
  const queue = createMockQueue();

  // Add payrollRun and payrollLineItem models to the mock client
  (db.client as any).payrollRun = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  };
  (db.client as any).payrollLineItem = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    count: vi.fn(),
  };
  (db.client as any).payrollAnomaly = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  };

  const service = new (ReconciliationService as any)(
    db,
    anomalyDetector,
    traceability,
    queue,
  ) as ReconciliationService;

  return { service, db, anomalyDetector, traceability, queue };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createReconciliationService());
  });

  // ─── createPayrollRun ──────────────────────────────────────

  describe('createPayrollRun', () => {
    it('should create a payroll run, insert line items, and compute totals', async () => {
      const mockRun = { id: 'run-1', tenantId: TEST_TENANT_ID, period: '2026-01', status: 'DRAFT', employeeCount: 2 };
      const mockUpdatedRun = { ...mockRun, totalGross: 8000, totalNet: 6500 };

      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 3 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([
        { component: 'BASE_SALARY', amount: 5000 },
        { component: 'BONUS', amount: 3000 },
        { component: 'TAX_FEDERAL', amount: 1500 },
      ]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockUpdatedRun);

      const dto = {
        period: '2026-01',
        lineItems: [
          { employeeId: 'emp-1', component: 'BASE_SALARY', amount: 5000, previousAmount: 4800 },
          { employeeId: 'emp-2', component: 'BONUS', amount: 3000 },
          { employeeId: 'emp-1', component: 'TAX_FEDERAL', amount: 1500 },
        ],
      };

      const result = await service.createPayrollRun(TEST_TENANT_ID, dto);

      expect(result).toEqual(mockUpdatedRun);
      expect(db.forTenant).toHaveBeenCalledWith(TEST_TENANT_ID, expect.any(Function));
      expect((db.client as any).payrollRun.create).toHaveBeenCalledWith({
        data: {
          tenantId: TEST_TENANT_ID,
          period: '2026-01',
          status: 'DRAFT',
          employeeCount: 2, // 2 unique employees
        },
      });
      expect((db.client as any).payrollLineItem.createMany).toHaveBeenCalledOnce();
    });

    it('should count unique employees correctly', async () => {
      const mockRun = { id: 'run-2', tenantId: TEST_TENANT_ID, period: '2026-02', status: 'DRAFT', employeeCount: 1 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 3 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([
        { component: 'BASE_SALARY', amount: 5000 },
        { component: 'BONUS', amount: 1000 },
        { component: 'TAX_FEDERAL', amount: 500 },
      ]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      const dto = {
        period: '2026-02',
        lineItems: [
          { employeeId: 'emp-1', component: 'BASE_SALARY', amount: 5000 },
          { employeeId: 'emp-1', component: 'BONUS', amount: 1000 },
          { employeeId: 'emp-1', component: 'TAX_FEDERAL', amount: 500 },
        ],
      };

      await service.createPayrollRun(TEST_TENANT_ID, dto);

      expect((db.client as any).payrollRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employeeCount: 1 }),
        }),
      );
    });

    it('should compute gross as sum of non-deduction components', async () => {
      const mockRun = { id: 'run-3', tenantId: TEST_TENANT_ID, period: '2026-03', status: 'DRAFT', employeeCount: 1 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 2 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([
        { component: 'BASE_SALARY', amount: 5000 },
        { component: 'HOUSING_ALLOWANCE', amount: 2000 },
      ]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      const dto = {
        period: '2026-03',
        lineItems: [
          { employeeId: 'emp-1', component: 'BASE_SALARY', amount: 5000 },
          { employeeId: 'emp-1', component: 'HOUSING_ALLOWANCE', amount: 2000 },
        ],
      };

      await service.createPayrollRun(TEST_TENANT_ID, dto);

      // gross = 5000 + 2000 = 7000, no deductions → net = 7000
      expect((db.client as any).payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-3' },
        data: { totalGross: 7000, totalNet: 7000 },
      });
    });

    it('should compute net = gross - deductions for all deduction prefixes', async () => {
      const mockRun = { id: 'run-4', tenantId: TEST_TENANT_ID, period: '2026-04', status: 'DRAFT', employeeCount: 1 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 6 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([
        { component: 'BASE_SALARY', amount: 10000 },
        { component: 'TAX_FEDERAL', amount: 2000 },
        { component: 'DEDUCTION_UNION', amount: 100 },
        { component: 'INSURANCE_HEALTH', amount: 500 },
        { component: 'PENSION_401K', amount: 800 },
        { component: 'CONTRIBUTION_CHARITY', amount: 50 },
      ]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      const dto = {
        period: '2026-04',
        lineItems: [
          { employeeId: 'emp-1', component: 'BASE_SALARY', amount: 10000 },
          { employeeId: 'emp-1', component: 'TAX_FEDERAL', amount: 2000 },
          { employeeId: 'emp-1', component: 'DEDUCTION_UNION', amount: 100 },
          { employeeId: 'emp-1', component: 'INSURANCE_HEALTH', amount: 500 },
          { employeeId: 'emp-1', component: 'PENSION_401K', amount: 800 },
          { employeeId: 'emp-1', component: 'CONTRIBUTION_CHARITY', amount: 50 },
        ],
      };

      await service.createPayrollRun(TEST_TENANT_ID, dto);

      // gross = 10000 (only BASE_SALARY), deductions = 2000+100+500+800+50 = 3450
      // net = 10000 - 3450 = 6550
      expect((db.client as any).payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-4' },
        data: { totalGross: 10000, totalNet: 6550 },
      });
    });

    it('should treat deduction prefixes case-insensitively', async () => {
      const mockRun = { id: 'run-5', tenantId: TEST_TENANT_ID, period: '2026-05', status: 'DRAFT', employeeCount: 1 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 2 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([
        { component: 'BASE_SALARY', amount: 5000 },
        { component: 'tax_state', amount: 300 },   // lowercase deduction prefix
      ]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      const dto = {
        period: '2026-05',
        lineItems: [
          { employeeId: 'emp-1', component: 'BASE_SALARY', amount: 5000 },
          { employeeId: 'emp-1', component: 'tax_state', amount: 300 },
        ],
      };

      await service.createPayrollRun(TEST_TENANT_ID, dto);

      // gross = 5000, deductions = 300, net = 4700
      expect((db.client as any).payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-5' },
        data: { totalGross: 5000, totalNet: 4700 },
      });
    });

    it('should use Math.abs for deduction amounts (handle negative deduction values)', async () => {
      const mockRun = { id: 'run-6', tenantId: TEST_TENANT_ID, period: '2026-06', status: 'DRAFT', employeeCount: 1 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 2 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([
        { component: 'BASE_SALARY', amount: 5000 },
        { component: 'TAX_FEDERAL', amount: -1000 },  // negative deduction
      ]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      const dto = {
        period: '2026-06',
        lineItems: [
          { employeeId: 'emp-1', component: 'BASE_SALARY', amount: 5000 },
          { employeeId: 'emp-1', component: 'TAX_FEDERAL', amount: -1000 },
        ],
      };

      await service.createPayrollRun(TEST_TENANT_ID, dto);

      // gross = 5000, deductions = abs(-1000) = 1000, net = 4000
      expect((db.client as any).payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-6' },
        data: { totalGross: 5000, totalNet: 4000 },
      });
    });

    it('should handle empty line items', async () => {
      const mockRun = { id: 'run-7', tenantId: TEST_TENANT_ID, period: '2026-07', status: 'DRAFT', employeeCount: 0 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      const dto = {
        period: '2026-07',
        lineItems: [],
      };

      const result = await service.createPayrollRun(TEST_TENANT_ID, dto);

      // Should not call createMany at all since no line items
      expect((db.client as any).payrollLineItem.createMany).not.toHaveBeenCalled();
      // gross = 0, net = 0
      expect((db.client as any).payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-7' },
        data: { totalGross: 0, totalNet: 0 },
      });
      expect(result).toEqual(mockRun);
    });

    it('should batch line items when exceeding batch size of 1000', async () => {
      const mockRun = { id: 'run-8', tenantId: TEST_TENANT_ID, period: '2026-08', status: 'DRAFT', employeeCount: 2500 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 1000 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      // Generate 2500 line items to trigger 3 batches (1000 + 1000 + 500)
      const lineItems = Array.from({ length: 2500 }, (_, i) => ({
        employeeId: `emp-${i}`,
        component: 'BASE_SALARY',
        amount: 100,
      }));

      const dto = { period: '2026-08', lineItems };

      await service.createPayrollRun(TEST_TENANT_ID, dto);

      // Should be called 3 times: batches of 1000, 1000, 500
      expect((db.client as any).payrollLineItem.createMany).toHaveBeenCalledTimes(3);

      // Verify first batch has 1000 items
      const firstBatchCall = (db.client as any).payrollLineItem.createMany.mock.calls[0][0];
      expect(firstBatchCall.data).toHaveLength(1000);

      // Verify second batch has 1000 items
      const secondBatchCall = (db.client as any).payrollLineItem.createMany.mock.calls[1][0];
      expect(secondBatchCall.data).toHaveLength(1000);

      // Verify third batch has 500 items
      const thirdBatchCall = (db.client as any).payrollLineItem.createMany.mock.calls[2][0];
      expect(thirdBatchCall.data).toHaveLength(500);
    });

    it('should produce a single batch for exactly 1000 items', async () => {
      const mockRun = { id: 'run-9', tenantId: TEST_TENANT_ID, period: '2026-09', status: 'DRAFT', employeeCount: 1000 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 1000 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      const lineItems = Array.from({ length: 1000 }, (_, i) => ({
        employeeId: `emp-${i}`,
        component: 'BASE_SALARY',
        amount: 100,
      }));

      await service.createPayrollRun(TEST_TENANT_ID, dto(lineItems));

      expect((db.client as any).payrollLineItem.createMany).toHaveBeenCalledTimes(1);
      expect((db.client as any).payrollLineItem.createMany.mock.calls[0][0].data).toHaveLength(1000);
    });

    it('should compute delta = amount - previousAmount for each line item', async () => {
      const mockRun = { id: 'run-10', tenantId: TEST_TENANT_ID, period: '2026-10', status: 'DRAFT', employeeCount: 1 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 2 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([
        { component: 'BASE_SALARY', amount: 5000 },
      ]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      const dto = {
        period: '2026-10',
        lineItems: [
          { employeeId: 'emp-1', component: 'BASE_SALARY', amount: 5000, previousAmount: 4500 },
          { employeeId: 'emp-1', component: 'BONUS', amount: 2000 },  // no previousAmount
        ],
      };

      await service.createPayrollRun(TEST_TENANT_ID, dto);

      const createManyCall = (db.client as any).payrollLineItem.createMany.mock.calls[0][0];
      expect(createManyCall.data[0]).toMatchObject({
        employeeId: 'emp-1',
        component: 'BASE_SALARY',
        amount: 5000,
        previousAmount: 4500,
        delta: 500,   // 5000 - 4500
      });
      expect(createManyCall.data[1]).toMatchObject({
        employeeId: 'emp-1',
        component: 'BONUS',
        amount: 2000,
        previousAmount: 0,   // defaults to 0
        delta: 2000,         // 2000 - 0
      });
    });

    it('should handle decimal precision in amounts', async () => {
      const mockRun = { id: 'run-11', tenantId: TEST_TENANT_ID, period: '2026-11', status: 'DRAFT', employeeCount: 1 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 2 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([
        { component: 'BASE_SALARY', amount: 5000.50 },
        { component: 'TAX_FEDERAL', amount: 1000.25 },
      ]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      const lineItemsDto = {
        period: '2026-11',
        lineItems: [
          { employeeId: 'emp-1', component: 'BASE_SALARY', amount: 5000.50 },
          { employeeId: 'emp-1', component: 'TAX_FEDERAL', amount: 1000.25 },
        ],
      };

      await service.createPayrollRun(TEST_TENANT_ID, lineItemsDto);

      // gross = 5000.50, deductions = 1000.25, net = 4000.25
      expect((db.client as any).payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-11' },
        data: { totalGross: 5000.50, totalNet: 4000.25 },
      });
    });

    it('should wrap the entire operation in a single forTenant transaction', async () => {
      const mockRun = { id: 'run-12', tenantId: TEST_TENANT_ID, period: '2026-12', status: 'DRAFT', employeeCount: 1 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 1 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([
        { component: 'BASE_SALARY', amount: 5000 },
      ]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      await service.createPayrollRun(TEST_TENANT_ID, {
        period: '2026-12',
        lineItems: [{ employeeId: 'emp-1', component: 'BASE_SALARY', amount: 5000 }],
      });

      // forTenant should be called exactly once for the entire createPayrollRun
      // (run create + line item insert + compute totals + update all in one tx)
      expect(db.forTenant).toHaveBeenCalledTimes(1);
      expect(db.forTenant).toHaveBeenCalledWith(TEST_TENANT_ID, expect.any(Function));
    });

    it('should set the payrollRunId on each line item', async () => {
      const mockRun = { id: 'run-13', tenantId: TEST_TENANT_ID, period: '2026-01', status: 'DRAFT', employeeCount: 1 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 1 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      await service.createPayrollRun(TEST_TENANT_ID, {
        period: '2026-01',
        lineItems: [{ employeeId: 'emp-1', component: 'BASE_SALARY', amount: 5000 }],
      });

      const createManyCall = (db.client as any).payrollLineItem.createMany.mock.calls[0][0];
      expect(createManyCall.data[0].payrollRunId).toBe('run-13');
    });

    it('should handle mixed deduction and non-deduction components for multiple employees', async () => {
      const mockRun = { id: 'run-14', tenantId: TEST_TENANT_ID, period: '2026-01', status: 'DRAFT', employeeCount: 2 };
      (db.client as any).payrollRun.create.mockResolvedValue(mockRun);
      (db.client as any).payrollLineItem.createMany.mockResolvedValue({ count: 6 });
      (db.client as any).payrollLineItem.findMany.mockResolvedValue([
        { component: 'BASE_SALARY', amount: 5000 },
        { component: 'BONUS', amount: 1000 },
        { component: 'TAX_FEDERAL', amount: 800 },
        { component: 'BASE_SALARY', amount: 6000 },
        { component: 'INSURANCE_MEDICAL', amount: 500 },
        { component: 'PENSION_PLAN', amount: 600 },
      ]);
      (db.client as any).payrollRun.update.mockResolvedValue(mockRun);

      const dto = {
        period: '2026-01',
        lineItems: [
          { employeeId: 'emp-1', component: 'BASE_SALARY', amount: 5000 },
          { employeeId: 'emp-1', component: 'BONUS', amount: 1000 },
          { employeeId: 'emp-1', component: 'TAX_FEDERAL', amount: 800 },
          { employeeId: 'emp-2', component: 'BASE_SALARY', amount: 6000 },
          { employeeId: 'emp-2', component: 'INSURANCE_MEDICAL', amount: 500 },
          { employeeId: 'emp-2', component: 'PENSION_PLAN', amount: 600 },
        ],
      };

      await service.createPayrollRun(TEST_TENANT_ID, dto);

      // gross = 5000 + 1000 + 6000 = 12000
      // deductions = 800 + 500 + 600 = 1900
      // net = 12000 - 1900 = 10100
      expect((db.client as any).payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-14' },
        data: { totalGross: 12000, totalNet: 10100 },
      });
    });
  });
});

// Helper to construct DTO from line items array
function dto(lineItems: Array<{ employeeId: string; component: string; amount: number; previousAmount?: number }>) {
  return { period: '2026-01', lineItems };
}
