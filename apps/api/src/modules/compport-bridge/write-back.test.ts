import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { WriteBackService } from './services/write-back.service';
import { createMockDatabaseService, TEST_TENANT_ID, TEST_USER_ID } from '../../test/setup';

// ─── Mock Cloud SQL Service ────────────────────────────────────────────────
function createMockCloudSqlService() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn().mockResolvedValue([]),
    executeWrite: vi.fn().mockResolvedValue({ affectedRows: [1] }),
    isHealthy: vi.fn().mockResolvedValue(true),
    isConnected: false,
  };
}

// ─── Mock Credential Vault ─────────────────────────────────────────────────
function createMockCredentialVault() {
  return {
    encrypt: vi.fn().mockReturnValue({
      encryptedData: 'enc',
      iv: 'iv',
      authTag: 'tag',
    }),
    decrypt: vi.fn().mockReturnValue({
      host: '10.0.0.1',
      port: 3306,
      user: 'root',
      password: 'secret',
    }),
  };
}

// ─── Mock History Service ────────────────────────────────────────────────
function createMockHistoryService() {
  return {
    insertHistory: vi.fn().mockResolvedValue(0),
    buildSalaryCascadeSetClauses: vi.fn().mockReturnValue([]),
    buildDateCascadeSetClauses: vi.fn().mockReturnValue([]),
    buildMetaSetClauses: vi.fn().mockReturnValue([]),
    getMetaParams: vi.fn().mockReturnValue([]),
  };
}

// ─── Factory ───────────────────────────────────────────────────────────────
function createWriteBackService() {
  const db = createMockDatabaseService();
  const cloudSql = createMockCloudSqlService();
  const historyService = createMockHistoryService();
  const credentialVault = createMockCredentialVault();
  const service = new (WriteBackService as any)(db, cloudSql, historyService, credentialVault);
  return { service: service as WriteBackService, db, cloudSql, historyService, credentialVault };
}

const CONNECTOR_ID = 'conn-cloudsql-001';
const CYCLE_ID = 'cycle-001';
const BATCH_ID = 'batch-001';

const MOCK_CONNECTOR = {
  id: CONNECTOR_ID,
  tenantId: TEST_TENANT_ID,
  connectorType: 'COMPPORT_CLOUDSQL',
  config: { schemaName: '200326_1585209819', tableName: 'employees' },
  encryptedCredentials: 'enc-data',
  credentialIv: 'iv-data',
  credentialTag: 'tag-data',
};

const MOCK_CYCLE = {
  id: CYCLE_ID,
  tenantId: TEST_TENANT_ID,
  name: 'Q1 Merit',
  status: 'APPROVAL',
};

const MOCK_BATCH = {
  id: BATCH_ID,
  tenantId: TEST_TENANT_ID,
  cycleId: CYCLE_ID,
  connectorId: CONNECTOR_ID,
  status: 'PENDING_REVIEW',
  totalRecords: 1,
  idempotencyKey: 'key-001',
  appliedAt: null,
  previewSql: null,
  dryRunResult: null,
  rollbackSql: null,
};

const VALID_RECORD = {
  recommendationId: 'rec-001',
  employeeId: 'emp-001',
  fieldName: 'base_salary',
  previousValue: '50000',
  newValue: '55000',
};

const MOCK_WRITE_BACK_RECORD = {
  id: 'wbr-001',
  batchId: BATCH_ID,
  ...VALID_RECORD,
  status: 'PENDING',
  createdAt: new Date(),
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('WriteBackService — createBatch', () => {
  let service: WriteBackService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createWriteBackService());
  });

  it('creates batch with PENDING_REVIEW status', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.compCycle.findFirst.mockResolvedValue(MOCK_CYCLE);
    db.client.writeBackBatch.create.mockResolvedValue({ ...MOCK_BATCH, id: 'new-batch' });
    db.client.writeBackRecord.createMany.mockResolvedValue({ count: 1 });
    db.client.auditLog.create.mockResolvedValue({});

    const result = await service.createBatch(TEST_TENANT_ID, CYCLE_ID, CONNECTOR_ID, [
      VALID_RECORD,
    ]);

    expect(result.id).toBe('new-batch');
    expect(db.client.writeBackBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING_REVIEW', totalRecords: 1 }),
      }),
    );
  });

  it('rejects invalid field names', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.compCycle.findFirst.mockResolvedValue(MOCK_CYCLE);

    const badRecord = { ...VALID_RECORD, fieldName: 'ssn_number' };
    await expect(
      service.createBatch(TEST_TENANT_ID, CYCLE_ID, CONNECTOR_ID, [badRecord]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-existent connector', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue(null);

    await expect(
      service.createBatch(TEST_TENANT_ID, CYCLE_ID, 'fake-conn', [VALID_RECORD]),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('WriteBackService — previewBatch', () => {
  let service: WriteBackService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createWriteBackService());
  });

  it('generates correct SQL preview', async () => {
    db.client.writeBackBatch.findFirst.mockResolvedValue(MOCK_BATCH);
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.writeBackRecord.findMany.mockResolvedValue([MOCK_WRITE_BACK_RECORD]);
    db.client.writeBackBatch.update.mockResolvedValue({});

    const result = await service.previewBatch(TEST_TENANT_ID, BATCH_ID);

    expect(result.schemaName).toBe('200326_1585209819');
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].sql).toContain('UPDATE');
    expect(result.statements[0].sql).toContain('base_salary');
    expect(result.statements[0].params).toEqual(['55000', 'emp-001']);
    // Batch should be updated to PREVIEWED
    expect(db.client.writeBackBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PREVIEWED' }),
      }),
    );
  });
});

describe('WriteBackService — dryRun', () => {
  let service: WriteBackService;
  let db: ReturnType<typeof createMockDatabaseService>;
  let cloudSql: ReturnType<typeof createMockCloudSqlService>;

  beforeEach(() => {
    ({ service, db, cloudSql } = createWriteBackService());
  });

  it('passes when all employees found and values match', async () => {
    db.client.writeBackBatch.findFirst.mockResolvedValue(MOCK_BATCH);
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.writeBackRecord.findMany.mockResolvedValue([MOCK_WRITE_BACK_RECORD]);
    db.client.writeBackBatch.update.mockResolvedValue({});
    db.client.auditLog.create.mockResolvedValue({});
    // resolveColumnName maps 'base_salary' → 'current_base_salary'
    cloudSql.executeQuery.mockResolvedValue([{ current_base_salary: '50000' }]);

    const result = await service.dryRun(TEST_TENANT_ID, BATCH_ID);

    expect(result.allPassed).toBe(true);
    expect(result.status).toBe('DRY_RUN_PASSED');
    expect(result.results[0].found).toBe(true);
    expect(result.results[0].matches).toBe(true);
  });

  it('fails when employee not found', async () => {
    db.client.writeBackBatch.findFirst.mockResolvedValue(MOCK_BATCH);
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.writeBackRecord.findMany.mockResolvedValue([MOCK_WRITE_BACK_RECORD]);
    db.client.writeBackBatch.update.mockResolvedValue({});
    db.client.auditLog.create.mockResolvedValue({});
    cloudSql.executeQuery.mockResolvedValue([]);

    const result = await service.dryRun(TEST_TENANT_ID, BATCH_ID);

    expect(result.allPassed).toBe(false);
    expect(result.status).toBe('DRY_RUN_FAILED');
    expect(result.results[0].found).toBe(false);
  });
});

describe('WriteBackService — applyBatch', () => {
  let service: WriteBackService;
  let db: ReturnType<typeof createMockDatabaseService>;
  let cloudSql: ReturnType<typeof createMockCloudSqlService>;

  beforeEach(() => {
    ({ service, db, cloudSql } = createWriteBackService());
  });

  it('rejects without "APPLY" confirmation phrase', async () => {
    await expect(
      service.applyBatch(TEST_TENANT_ID, BATCH_ID, TEST_USER_ID, 'apply'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects double-apply (idempotency)', async () => {
    const appliedBatch = {
      ...MOCK_BATCH,
      status: 'DRY_RUN_PASSED',
      appliedAt: new Date(),
    };
    db.client.writeBackBatch.findFirst.mockResolvedValue(appliedBatch);

    await expect(
      service.applyBatch(TEST_TENANT_ID, BATCH_ID, TEST_USER_ID, 'APPLY'),
    ).rejects.toThrow(BadRequestException);
  });

  it('marks records APPLIED on success', async () => {
    const passedBatch = { ...MOCK_BATCH, status: 'DRY_RUN_PASSED' };
    db.client.writeBackBatch.findFirst.mockResolvedValue(passedBatch);
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.writeBackBatch.update.mockResolvedValue({});
    db.client.writeBackRecord.findMany.mockResolvedValue([MOCK_WRITE_BACK_RECORD]);
    db.client.writeBackRecord.update.mockResolvedValue({});
    db.client.compRecommendation.update.mockResolvedValue({});
    db.client.auditLog.create.mockResolvedValue({});
    cloudSql.executeWrite.mockResolvedValue({ affectedRows: [1] });

    const result = await service.applyBatch(TEST_TENANT_ID, BATCH_ID, TEST_USER_ID, 'APPLY');

    expect(result.status).toBe('APPLIED');
    expect(result.appliedRecords).toBe(1);
    expect(cloudSql.executeWrite).toHaveBeenCalledWith(
      '200326_1585209819',
      expect.arrayContaining([
        expect.objectContaining({
          sql: expect.stringContaining('base_salary'),
        }),
      ]),
    );
  });

  it('rolls back on Cloud SQL failure', async () => {
    const passedBatch = { ...MOCK_BATCH, status: 'DRY_RUN_PASSED' };
    db.client.writeBackBatch.findFirst.mockResolvedValue(passedBatch);
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.writeBackBatch.update.mockResolvedValue({});
    db.client.writeBackRecord.findMany.mockResolvedValue([MOCK_WRITE_BACK_RECORD]);
    db.client.auditLog.create.mockResolvedValue({});
    cloudSql.executeWrite.mockRejectedValue(new Error('Connection lost'));

    await expect(
      service.applyBatch(TEST_TENANT_ID, BATCH_ID, TEST_USER_ID, 'APPLY'),
    ).rejects.toThrow('Connection lost');

    // Verify batch was marked FAILED
    expect(db.client.writeBackBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
});
