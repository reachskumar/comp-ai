import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Request,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from '../../../auth';
import { TenantGuard, PermissionGuard, RequirePermission } from '../../../common';
import { InboundSyncService } from '../services/inbound-sync.service';
import { SchemaDiscoveryService } from '../services/schema-discovery.service';
import { TenantRegistryService } from '../services/tenant-registry.service';
import { INBOUND_SYNC_QUEUE, type InboundSyncJobData } from '../processors/inbound-sync.processor';
import { DatabaseService } from '../../../database';
import { CredentialVaultService } from '../../integrations/services/credential-vault.service';
import { CompportCloudSqlService } from '../services/compport-cloudsql.service';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

/**
 * Inbound Sync Controller.
 *
 * API endpoints for Cloud SQL → PostgreSQL sync:
 * - Trigger sync (queues BullMQ job)
 * - View sync status and history
 * - Schema discovery (list databases, tables, columns)
 * - Tenant registry (list Compport tenants)
 *
 * All endpoints require Admin role + JWT auth.
 */
@ApiTags('compport-inbound-sync')
@Controller('compport-bridge')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@RequirePermission('Inbound Sync', 'view')
@ApiBearerAuth()
export class InboundSyncController {
  private readonly logger = new Logger(InboundSyncController.name);

  constructor(
    private readonly inboundSyncService: InboundSyncService,
    private readonly schemaDiscovery: SchemaDiscoveryService,
    private readonly tenantRegistry: TenantRegistryService,
    private readonly db: DatabaseService,
    private readonly credentialVault: CredentialVaultService,
    private readonly cloudSql: CompportCloudSqlService,
    @InjectQueue(INBOUND_SYNC_QUEUE) private readonly syncQueue: Queue,
  ) {}

  // ─── Sync Endpoints ──────────────────────────────────────

  @Post('sync/:connectorId')
  @ApiOperation({ summary: 'Trigger inbound sync from Cloud SQL' })
  async triggerSync(@Request() req: AuthRequest, @Param('connectorId') connectorId: string) {
    const { tenantId, userId } = req.user;
    this.logger.log(`Inbound sync triggered: user=${userId}, connector=${connectorId}`);

    // Create a SyncJob record
    const syncJob = await this.db.forTenant(tenantId, (tx) =>
      tx.syncJob.create({
        data: {
          tenantId,
          connectorId,
          direction: 'INBOUND',
          entityType: 'employee',
          status: 'PENDING',
          metadata: { triggeredBy: userId } as never,
        },
      }),
    );

    // Enqueue BullMQ job
    const jobData: InboundSyncJobData = {
      tenantId,
      connectorId,
      entityType: 'all',
      syncJobId: syncJob.id,
    };

    const job = await this.syncQueue.add('inbound-sync', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 604800 },
      jobId: `inbound-sync-${tenantId}-${connectorId}-${Date.now()}`, // Unique per trigger
    });

    return {
      jobId: job.id,
      syncJobId: syncJob.id,
      connectorId,
      status: 'QUEUED',
      message: 'Inbound sync job queued.',
    };
  }

  @Get('sync/:connectorId/status')
  @ApiOperation({ summary: 'Get latest sync job status' })
  async getSyncStatus(@Request() req: AuthRequest, @Param('connectorId') connectorId: string) {
    const latest = await this.db.forTenant(req.user.tenantId, (tx) =>
      tx.syncJob.findFirst({
        where: { connectorId, tenantId: req.user.tenantId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return latest ?? { status: 'NEVER_RUN', message: 'No sync has been run for this connector.' };
  }

  @Get('sync/:connectorId/history')
  @ApiOperation({ summary: 'Get sync job history (paginated)' })
  async getSyncHistory(
    @Request() req: AuthRequest,
    @Param('connectorId') connectorId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = Math.max(1, parseInt(page ?? '1', 10));
    const l = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10)));

    const [jobs, total] = await this.db.forTenant(req.user.tenantId, async (tx) => {
      const where = { connectorId, tenantId: req.user.tenantId };
      return Promise.all([
        tx.syncJob.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (p - 1) * l,
          take: l,
        }),
        tx.syncJob.count({ where }),
      ]);
    });

    return { jobs, total, page: p, limit: l, totalPages: Math.ceil(total / l) };
  }

  // ─── Schema Discovery Endpoints ──────────────────────────

  @Get('discovery/schemas')
  @ApiOperation({ summary: 'List Cloud SQL schemas (databases)' })
  async listSchemas(@Request() req: AuthRequest) {
    await this.ensureCloudSqlConnected(req.user.tenantId);
    try {
      const schemas = await this.schemaDiscovery.discoverSchemas();
      return { schemas };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  @Get('discovery/schemas/:schemaName/tables')
  @ApiOperation({ summary: 'List tables in a Cloud SQL schema' })
  async listTables(@Request() req: AuthRequest, @Param('schemaName') schemaName: string) {
    await this.ensureCloudSqlConnected(req.user.tenantId);
    try {
      const tables = await this.schemaDiscovery.discoverTables(schemaName);
      return { schemaName, tables };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  @Get('discovery/schemas/:schemaName/tables/:tableName/columns')
  @ApiOperation({ summary: 'Describe columns in a Cloud SQL table' })
  async describeColumns(
    @Request() req: AuthRequest,
    @Param('schemaName') schemaName: string,
    @Param('tableName') tableName: string,
  ) {
    await this.ensureCloudSqlConnected(req.user.tenantId);
    try {
      const columns = await this.schemaDiscovery.discoverColumns(schemaName, tableName);
      return { schemaName, tableName, columns };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  // ─── Tenant Registry Endpoints ───────────────────────────

  @Get('tenants')
  @ApiOperation({ summary: 'List Compport tenants from platform_admin_db' })
  async listTenants(@Request() req: AuthRequest) {
    await this.ensureCloudSqlConnected(req.user.tenantId);
    try {
      const tenants = await this.tenantRegistry.discoverTenants();
      return { tenants, count: tenants.length };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  // ─── Direct Query Endpoints ────────────────────────────────

  /**
   * Validate that a name is a safe SQL identifier (letters, digits, underscores).
   */
  private validateIdentifier(name: string, label: string): void {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      throw new BadRequestException(
        `Invalid ${label}: "${name}". Only letters, digits, and underscores are allowed.`,
      );
    }
  }

  @Get('query/:schemaName/:tableName/count')
  @ApiOperation({ summary: 'Get row count for a Cloud SQL table' })
  async queryTableCount(
    @Request() req: AuthRequest,
    @Param('schemaName') schemaName: string,
    @Param('tableName') tableName: string,
  ) {
    this.validateIdentifier(schemaName, 'schema name');
    this.validateIdentifier(tableName, 'table name');

    await this.ensureCloudSqlConnected(req.user.tenantId);
    try {
      const rows = await this.cloudSql.executeQuery<{ cnt: number }>(
        schemaName,
        `SELECT COUNT(*) AS cnt FROM \`${tableName}\``,
      );
      const count = Number(rows[0]?.cnt ?? 0);
      return { schemaName, tableName, count };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  @Get('query/:schemaName/:tableName')
  @ApiOperation({ summary: 'Query rows from a Cloud SQL table (paginated)' })
  async queryTable(
    @Request() req: AuthRequest,
    @Param('schemaName') schemaName: string,
    @Param('tableName') tableName: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('columns') columnsStr?: string,
    @Query('orderBy') orderBy?: string,
    @Query('orderDir') orderDir?: string,
    @Query('filterColumn') filterColumn?: string,
    @Query('filterValues') filterValues?: string,
  ) {
    this.validateIdentifier(schemaName, 'schema name');
    this.validateIdentifier(tableName, 'table name');

    const limit = Math.min(1000, Math.max(1, parseInt(limitStr ?? '100', 10)));
    const offset = Math.max(0, parseInt(offsetStr ?? '0', 10));

    // Build column list — validate each column name
    let columnsSql = '*';
    if (columnsStr) {
      const cols = columnsStr
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      for (const col of cols) {
        this.validateIdentifier(col, 'column name');
      }
      columnsSql = cols.map((c) => `\`${c}\``).join(', ');
    }

    // Build WHERE clause for filtering by column values (IN clause)
    let whereSql = '';
    const whereParams: unknown[] = [];
    if (filterColumn && filterValues) {
      this.validateIdentifier(filterColumn, 'filter column');
      const values = filterValues
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (values.length > 0 && values.length <= 200) {
        const placeholders = values.map(() => '?').join(', ');
        whereSql = ` WHERE \`${filterColumn}\` IN (${placeholders})`;
        whereParams.push(...values);
      }
    }

    // Build ORDER BY clause
    let orderSql = '';
    if (orderBy) {
      this.validateIdentifier(orderBy, 'orderBy column');
      const dir = orderDir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      orderSql = ` ORDER BY \`${orderBy}\` ${dir}`;
    }

    await this.ensureCloudSqlConnected(req.user.tenantId);
    try {
      // Get total count and rows in parallel
      const [countRows, rows] = await Promise.all([
        this.cloudSql.executeQuery<{ cnt: number }>(
          schemaName,
          `SELECT COUNT(*) AS cnt FROM \`${tableName}\`${whereSql}`,
          whereParams.length > 0 ? whereParams : undefined,
        ),
        this.cloudSql.executeQuery(
          schemaName,
          `SELECT ${columnsSql} FROM \`${tableName}\`${whereSql}${orderSql} LIMIT ? OFFSET ?`,
          [...whereParams, limit, offset],
        ),
      ]);

      const totalCount = Number(countRows[0]?.cnt ?? 0);
      return { schemaName, tableName, rows, totalCount, limit, offset };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  // ─── Tenant-Scoped Query Endpoints (auto-resolve schema) ──

  /**
   * Resolve the Compport MySQL schema name for the logged-in tenant.
   */
  private async resolveCompportSchema(tenantId: string): Promise<string> {
    const tenant = await this.db.forTenant(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { compportSchema: true, name: true },
      }),
    );

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    if (!tenant.compportSchema) {
      throw new BadRequestException(
        `Tenant "${tenant.name}" has no Compport schema linked. Onboard via Platform Admin first.`,
      );
    }
    return tenant.compportSchema;
  }

  @Get('my-data/tables')
  @ApiOperation({ summary: "List tables in the logged-in tenant's Compport schema" })
  async myDataTables(@Request() req: AuthRequest) {
    const { tenantId } = req.user;
    const schemaName = await this.resolveCompportSchema(tenantId);

    await this.ensureCloudSqlConnected(tenantId);
    try {
      const tables = await this.schemaDiscovery.discoverTables(schemaName);
      return { schemaName, tables, count: tables.length };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  @Get('my-data/:tableName/count')
  @ApiOperation({ summary: "Get row count for a table in the tenant's Compport schema" })
  async myDataCount(@Request() req: AuthRequest, @Param('tableName') tableName: string) {
    this.validateIdentifier(tableName, 'table name');
    const { tenantId } = req.user;
    const schemaName = await this.resolveCompportSchema(tenantId);

    await this.ensureCloudSqlConnected(tenantId);
    try {
      const rows = await this.cloudSql.executeQuery<{ cnt: number }>(
        schemaName,
        `SELECT COUNT(*) AS cnt FROM \`${tableName}\``,
      );
      return { tableName, count: Number(rows[0]?.cnt ?? 0) };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  @Get('my-data/:tableName')
  @ApiOperation({ summary: "Query rows from a table in the tenant's Compport schema" })
  async myDataQuery(
    @Request() req: AuthRequest,
    @Param('tableName') tableName: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('columns') columnsStr?: string,
    @Query('orderBy') orderBy?: string,
    @Query('orderDir') orderDir?: string,
  ) {
    this.validateIdentifier(tableName, 'table name');
    const { tenantId } = req.user;
    const schemaName = await this.resolveCompportSchema(tenantId);

    const limit = Math.min(1000, Math.max(1, parseInt(limitStr ?? '100', 10)));
    const offset = Math.max(0, parseInt(offsetStr ?? '0', 10));

    let columnsSql = '*';
    if (columnsStr) {
      const cols = columnsStr
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      for (const col of cols) {
        this.validateIdentifier(col, 'column name');
      }
      columnsSql = cols.map((c) => `\`${c}\``).join(', ');
    }

    let orderSql = '';
    if (orderBy) {
      this.validateIdentifier(orderBy, 'orderBy column');
      const dir = orderDir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      orderSql = ` ORDER BY \`${orderBy}\` ${dir}`;
    }

    await this.ensureCloudSqlConnected(tenantId);
    try {
      const [countRows, rows] = await Promise.all([
        this.cloudSql.executeQuery<{ cnt: number }>(
          schemaName,
          `SELECT COUNT(*) AS cnt FROM \`${tableName}\``,
        ),
        this.cloudSql.executeQuery(
          schemaName,
          `SELECT ${columnsSql} FROM \`${tableName}\`${orderSql} LIMIT ? OFFSET ?`,
          [limit, offset],
        ),
      ]);

      const totalCount = Number(countRows[0]?.cnt ?? 0);
      return { tableName, rows, totalCount, limit, offset };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  // ─── Private Helpers ─────────────────────────────────────

  /**
   * Connect to Cloud SQL using the first active COMPPORT_CLOUDSQL connector.
   */
  private async ensureCloudSqlConnected(tenantId: string): Promise<void> {
    const connector = await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.findFirst({
        where: {
          tenantId,
          connectorType: 'COMPPORT_CLOUDSQL',
          status: 'ACTIVE',
        },
      }),
    );

    if (!connector) {
      throw new Error('No active COMPPORT_CLOUDSQL connector found for this tenant');
    }

    if (!connector.encryptedCredentials || !connector.credentialIv || !connector.credentialTag) {
      throw new Error('Connector has no stored credentials');
    }

    const creds = this.credentialVault.decrypt(
      tenantId,
      connector.encryptedCredentials,
      connector.credentialIv,
      connector.credentialTag,
    );

    await this.cloudSql.connect({
      host: creds['host'] as string,
      port: (creds['port'] as number) ?? 3306,
      user: creds['user'] as string,
      password: creds['password'] as string,
      database: creds['database'] as string | undefined,
      sslCa: process.env['MYSQL_CA_CERT'],
      sslCert: process.env['MYSQL_CLIENT_CERT'],
      sslKey: process.env['MYSQL_CLIENT_KEY'],
    });
  }
}
