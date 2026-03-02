import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InboundSyncService } from './services/inbound-sync.service';
import { SchemaDiscoveryService } from './services/schema-discovery.service';
import { TenantRegistryService } from './services/tenant-registry.service';
import { createMockDatabaseService, TEST_TENANT_ID } from '../../test/setup';

// ─── Mock Cloud SQL Service ────────────────────────────────────────────────
function createMockCloudSqlService() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    executeQuery: vi.fn().mockResolvedValue([]),
    executeWrite: vi.fn().mockResolvedValue({ affectedRows: [1] }),
    showTables: vi.fn().mockResolvedValue([]),
    describeTable: vi.fn().mockResolvedValue([]),
    isHealthy: vi.fn().mockResolvedValue(true),
    isConnected: false,
  };
}

// ─── Mock Credential Vault ─────────────────────────────────────────────────
function createMockCredentialVault() {
  return {
    encrypt: vi.fn().mockReturnValue({ encryptedData: 'enc', iv: 'iv', authTag: 'tag' }),
    decrypt: vi.fn().mockReturnValue({
      host: '10.0.0.1',
      port: 3306,
      user: 'root',
      password: 'secret',
    }),
  };
}

// ─── Mock FieldMapping Service ─────────────────────────────────────────────
function createMockFieldMappingService() {
  return {
    findByConnector: vi.fn().mockResolvedValue([]),
    applyMappings: vi.fn().mockReturnValue({ success: true, mappedData: {}, errors: [] }),
    getMappings: vi.fn().mockResolvedValue([]),
    createMapping: vi.fn(),
    updateMapping: vi.fn(),
    deleteMapping: vi.fn(),
  };
}

// ─── Factory Functions ─────────────────────────────────────────────────────
function createInboundSyncService() {
  const db = createMockDatabaseService();
  const cloudSql = createMockCloudSqlService();
  const credentialVault = createMockCredentialVault();
  const fieldMapping = createMockFieldMappingService();
  const service = new (InboundSyncService as any)(db, cloudSql, credentialVault, fieldMapping);
  return { service: service as InboundSyncService, db, cloudSql, credentialVault, fieldMapping };
}

function createSchemaDiscoveryService() {
  const cloudSql = createMockCloudSqlService();
  const service = new (SchemaDiscoveryService as any)(cloudSql);
  return { service: service as SchemaDiscoveryService, cloudSql };
}

function createTenantRegistryService() {
  const cloudSql = createMockCloudSqlService();
  const service = new (TenantRegistryService as any)(cloudSql);
  return { service: service as TenantRegistryService, cloudSql };
}

// ─── Constants ─────────────────────────────────────────────────────────────
const CONNECTOR_ID = 'conn-cloudsql-001';
const SYNC_JOB_ID = 'syncjob-001';

const MOCK_CONNECTOR = {
  id: CONNECTOR_ID,
  tenantId: TEST_TENANT_ID,
  connectorType: 'COMPPORT_CLOUDSQL',
  config: { schemaName: '200326_1585209819', tableName: 'employees' },
  encryptedCredentials: 'enc-data',
  credentialIv: 'iv-data',
  credentialTag: 'tag-data',
};

const MOCK_EMPLOYEE_ROW = {
  employee_id: 'EMP-001',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@acme.com',
  department: 'Engineering',
  title: 'Senior Engineer',
  hire_date: '2020-01-15',
  base_salary: 120000,
  currency: 'USD',
};

// ─── SchemaDiscoveryService ────────────────────────────────────────────────

describe('SchemaDiscoveryService', () => {
  let service: SchemaDiscoveryService;
  let cloudSql: ReturnType<typeof createMockCloudSqlService>;

  beforeEach(() => {
    ({ service, cloudSql } = createSchemaDiscoveryService());
  });

  it('discovers schemas excluding system databases', async () => {
    cloudSql.executeQuery.mockResolvedValue([
      { Database: 'information_schema' },
      { Database: 'mysql' },
      { Database: '200326_1585209819' },
      { Database: '200415_1586900000' },
      { Database: 'performance_schema' },
      { Database: 'sys' },
    ]);

    const schemas = await service.discoverSchemas();

    expect(schemas).toEqual(['200326_1585209819', '200415_1586900000']);
    expect(schemas).not.toContain('information_schema');
    expect(schemas).not.toContain('mysql');
  });

  it('discovers tables for a schema', async () => {
    cloudSql.showTables.mockResolvedValue(['employees', 'compensation', 'departments']);

    const tables = await service.discoverTables('200326_1585209819');

    expect(tables).toEqual(['employees', 'compensation', 'departments']);
    expect(cloudSql.showTables).toHaveBeenCalledWith('200326_1585209819');
  });

  it('discovers columns with correct mapping', async () => {
    cloudSql.describeTable.mockResolvedValue([
      {
        Field: 'id',
        Type: 'int(11)',
        Null: 'NO',
        Key: 'PRI',
        Default: null,
        Extra: 'auto_increment',
      },
      { Field: 'name', Type: 'varchar(255)', Null: 'YES', Key: '', Default: null, Extra: '' },
    ]);

    const columns = await service.discoverColumns('200326_1585209819', 'employees');

    expect(columns).toHaveLength(2);
    expect(columns[0]).toEqual({
      name: 'id',
      type: 'int(11)',
      nullable: false,
      key: 'PRI',
      defaultValue: null,
      extra: 'auto_increment',
    });
    expect(columns[1]!.nullable).toBe(true);
  });

  it('performs full tenant schema discovery', async () => {
    cloudSql.showTables.mockResolvedValue(['employees']);
    cloudSql.describeTable.mockResolvedValue([
      {
        Field: 'employee_id',
        Type: 'varchar(50)',
        Null: 'NO',
        Key: 'PRI',
        Default: null,
        Extra: '',
      },
    ]);

    const schema = await service.discoverTenantSchema('200326_1585209819');

    expect(schema.name).toBe('200326_1585209819');
    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0]!.name).toBe('employees');
    expect(schema.tables[0]!.columns).toHaveLength(1);
  });
});

// ─── TenantRegistryService ─────────────────────────────────────────────────

describe('TenantRegistryService', () => {
  let service: TenantRegistryService;
  let cloudSql: ReturnType<typeof createMockCloudSqlService>;

  beforeEach(() => {
    ({ service, cloudSql } = createTenantRegistryService());
  });

  it('discovers tenants from platform_admin_db', async () => {
    // First call: verify database exists
    cloudSql.executeQuery
      .mockResolvedValueOnce([{ Database: 'platform_admin_db' }])
      // Second call: query clients table
      .mockResolvedValueOnce([
        {
          database_name: '200326_1585209819',
          company_name: 'Acme Corp',
          status: 'active',
          created_at: '2020-03-26',
          employee_count: 500,
        },
        {
          database_name: '200415_1586900000',
          company_name: 'Globex Inc',
          status: 'active',
          created_at: '2020-04-15',
          employee_count: 200,
        },
      ]);

    const tenants = await service.discoverTenants();

    expect(tenants).toHaveLength(2);
    expect(tenants[0]).toEqual({
      schemaName: '200326_1585209819',
      companyName: 'Acme Corp',
      status: 'active',
      createdAt: '2020-03-26',
      employeeCount: 500,
    });
  });

  it('throws when platform_admin_db not found', async () => {
    cloudSql.executeQuery.mockResolvedValueOnce([]); // No database found

    await expect(service.discoverTenants()).rejects.toThrow(BadRequestException);
    await expect(service.discoverTenants()).rejects.toThrow('platform_admin_db');
  });

  it('throws descriptive error when clients table missing', async () => {
    cloudSql.executeQuery
      .mockResolvedValueOnce([{ Database: 'platform_admin_db' }])
      .mockRejectedValueOnce(new Error("Table 'platform_admin_db.clients' doesn't exist"));

    await expect(service.discoverTenants()).rejects.toThrow(BadRequestException);
  });

  it('finds tenant by schema name', async () => {
    cloudSql.executeQuery.mockResolvedValueOnce([
      {
        database_name: '200326_1585209819',
        company_name: 'Acme Corp',
        status: 'active',
        created_at: null,
        employee_count: null,
      },
    ]);

    const tenant = await service.findTenantBySchema('200326_1585209819');

    expect(tenant).not.toBeNull();
    expect(tenant!.companyName).toBe('Acme Corp');
  });

  it('returns null for unknown schema', async () => {
    cloudSql.executeQuery.mockResolvedValueOnce([]);

    const tenant = await service.findTenantBySchema('nonexistent');

    expect(tenant).toBeNull();
  });
});

// ─── InboundSyncService ────────────────────────────────────────────────────

describe('InboundSyncService — syncAll', () => {
  let service: InboundSyncService;
  let db: ReturnType<typeof createMockDatabaseService>;
  let cloudSql: ReturnType<typeof createMockCloudSqlService>;
  let fieldMapping: ReturnType<typeof createMockFieldMappingService>;

  beforeEach(() => {
    ({ service, db, cloudSql, fieldMapping } = createInboundSyncService());
  });

  it('syncs employees with default mapping (no field mappings)', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.syncJob.update.mockResolvedValue({});
    db.client.syncLog.create.mockResolvedValue({});
    db.client.integrationConnector.update.mockResolvedValue({});
    db.client.employee.upsert.mockResolvedValue({});
    fieldMapping.findByConnector.mockResolvedValue([]);
    cloudSql.executeQuery
      .mockResolvedValueOnce([MOCK_EMPLOYEE_ROW]) // First batch
      .mockResolvedValueOnce([]); // End of data

    const result = await service.syncAll(TEST_TENANT_ID, CONNECTOR_ID, SYNC_JOB_ID);

    expect(result.processedRecords).toBe(1);
    expect(result.failedRecords).toBe(0);
    expect(result.skippedRecords).toBe(0);
    expect(result.totalRecords).toBe(1);
    expect(result.syncJobId).toBe(SYNC_JOB_ID);
    expect(result.entityType).toBe('employee');
    expect(db.client.employee.upsert).toHaveBeenCalledTimes(1);
    expect(cloudSql.disconnect).toHaveBeenCalled();
  });

  it('syncs with field mappings when configured', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.syncJob.update.mockResolvedValue({});
    db.client.syncLog.create.mockResolvedValue({});
    db.client.integrationConnector.update.mockResolvedValue({});
    db.client.employee.upsert.mockResolvedValue({});

    const mappings = [
      {
        sourceField: 'first_name',
        targetField: 'firstName',
        transformType: 'direct',
        transformConfig: {},
        isRequired: false,
        defaultValue: null,
      },
    ];
    fieldMapping.findByConnector.mockResolvedValue(mappings);
    fieldMapping.applyMappings.mockReturnValue({
      success: true,
      mappedData: { firstName: 'Jane' },
      errors: [],
    });

    cloudSql.executeQuery.mockResolvedValueOnce([MOCK_EMPLOYEE_ROW]).mockResolvedValueOnce([]);

    const result = await service.syncAll(TEST_TENANT_ID, CONNECTOR_ID, SYNC_JOB_ID);

    expect(result.processedRecords).toBe(1);
    expect(fieldMapping.applyMappings).toHaveBeenCalledTimes(1);
  });

  it('skips rows that fail Zod validation', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.syncJob.update.mockResolvedValue({});
    db.client.syncLog.create.mockResolvedValue({});
    db.client.integrationConnector.update.mockResolvedValue({});
    fieldMapping.findByConnector.mockResolvedValue([]);

    // Row missing required employee_id
    cloudSql.executeQuery
      .mockResolvedValueOnce([{ name: 'No ID employee' }])
      .mockResolvedValueOnce([]);

    const result = await service.syncAll(TEST_TENANT_ID, CONNECTOR_ID, SYNC_JOB_ID);

    expect(result.skippedRecords).toBe(1);
    expect(result.processedRecords).toBe(0);
    expect(db.client.employee.upsert).not.toHaveBeenCalled();
  });

  it('handles empty Cloud SQL result', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.syncJob.update.mockResolvedValue({});
    db.client.syncLog.create.mockResolvedValue({});
    db.client.integrationConnector.update.mockResolvedValue({});
    fieldMapping.findByConnector.mockResolvedValue([]);
    cloudSql.executeQuery.mockResolvedValueOnce([]);

    const result = await service.syncAll(TEST_TENANT_ID, CONNECTOR_ID, SYNC_JOB_ID);

    expect(result.totalRecords).toBe(0);
    expect(result.processedRecords).toBe(0);
  });

  it('throws when connector not found', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue(null);

    await expect(service.syncAll(TEST_TENANT_ID, 'fake-conn', SYNC_JOB_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws when connector has no credentials', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue({
      ...MOCK_CONNECTOR,
      encryptedCredentials: null,
      credentialIv: null,
      credentialTag: null,
    });

    await expect(service.syncAll(TEST_TENANT_ID, CONNECTOR_ID, SYNC_JOB_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws when connector config missing schemaName', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue({
      ...MOCK_CONNECTOR,
      config: { tableName: 'employees' }, // No schemaName
    });

    await expect(service.syncAll(TEST_TENANT_ID, CONNECTOR_ID, SYNC_JOB_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('marks sync job as FAILED when all records error', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    db.client.syncJob.update.mockResolvedValue({});
    db.client.syncLog.create.mockResolvedValue({});
    db.client.integrationConnector.update.mockResolvedValue({});
    db.client.employee.upsert.mockRejectedValue(new Error('DB constraint violation'));
    fieldMapping.findByConnector.mockResolvedValue([]);

    cloudSql.executeQuery.mockResolvedValueOnce([MOCK_EMPLOYEE_ROW]).mockResolvedValueOnce([]);

    const result = await service.syncAll(TEST_TENANT_ID, CONNECTOR_ID, SYNC_JOB_ID);

    expect(result.failedRecords).toBe(1);
    expect(result.processedRecords).toBe(0);
    // Verify sync job marked as FAILED
    expect(db.client.syncJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('disconnects Cloud SQL even when sync throws', async () => {
    db.client.integrationConnector.findFirst.mockResolvedValue(MOCK_CONNECTOR);
    fieldMapping.findByConnector.mockResolvedValue([]);
    // Cloud SQL executeQuery throws after connect succeeds
    cloudSql.executeQuery.mockRejectedValue(new Error('Connection reset'));

    await expect(service.syncAll(TEST_TENANT_ID, CONNECTOR_ID, SYNC_JOB_ID)).rejects.toThrow(
      'Connection reset',
    );

    expect(cloudSql.disconnect).toHaveBeenCalled();
  });
});
