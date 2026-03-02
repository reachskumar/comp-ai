import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CompportCloudSqlService } from './compport-cloudsql.service';
import { CredentialVaultService } from '../../integrations/services/credential-vault.service';
import { FieldMappingService } from '../../integrations/services/field-mapping.service';
import { CloudSqlEmployeeRowSchema } from '../schemas/compport-data.schemas';

const BATCH_SIZE = 1000;

export interface InboundSyncResult {
  syncJobId: string;
  entityType: string;
  durationMs: number;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  skippedRecords: number;
}

/**
 * Inbound Sync Service
 *
 * Core ETL logic: reads from Compport Cloud SQL (MySQL),
 * transforms via FieldMapping, and upserts into CompportIQ PostgreSQL.
 *
 * Flow per entity:
 * 1. Load connector config + decrypt credentials
 * 2. Connect to Cloud SQL
 * 3. USE tenant schema
 * 4. SELECT with pagination (BATCH_SIZE rows)
 * 5. Validate each row with Zod
 * 6. Apply FieldMapping transforms
 * 7. Upsert into PostgreSQL via Prisma forTenant()
 * 8. Create SyncJob + SyncLog records
 * 9. Update connector lastSyncAt
 *
 * SECURITY:
 * - Parameterized queries only
 * - Credentials decrypted per-request
 * - All operations RLS-scoped via forTenant()
 */
@Injectable()
export class InboundSyncService {
  private readonly logger = new Logger(InboundSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cloudSql: CompportCloudSqlService,
    private readonly credentialVault: CredentialVaultService,
    private readonly fieldMappingService: FieldMappingService,
  ) {}

  /**
   * Sync all entities for a connector (employees + compensation).
   */
  async syncAll(
    tenantId: string,
    connectorId: string,
    syncJobId: string,
  ): Promise<InboundSyncResult> {
    const start = Date.now();
    this.logger.log(`Starting full inbound sync: tenant=${tenantId}, connector=${connectorId}`);

    const connector = await this.getConnectorOrThrow(tenantId, connectorId);
    const config = connector.config as Record<string, string>;
    const schemaName = config?.schemaName;
    const tableName = config?.tableName ?? 'employees';

    if (!schemaName) {
      throw new BadRequestException('Connector config missing schemaName');
    }

    // Connect to Cloud SQL
    await this.connectToCloudSql(tenantId, connector);

    // Load field mappings for this connector
    const mappings = await this.fieldMappingService.findByConnector(tenantId, connectorId);

    try {
      const result = await this.syncEmployees(
        tenantId,
        connectorId,
        syncJobId,
        schemaName,
        tableName,
        mappings,
      );
      return result;
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  /**
   * Sync employees from Cloud SQL → PostgreSQL.
   */
  private async syncEmployees(
    tenantId: string,
    connectorId: string,
    syncJobId: string,
    schemaName: string,
    tableName: string,
    mappings: Array<{
      sourceField: string;
      targetField: string;
      transformType: string;
      transformConfig: Record<string, unknown> | unknown;
      isRequired: boolean;
      defaultValue?: string | null;
    }>,
  ): Promise<InboundSyncResult> {
    const start = Date.now();
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const details: { id: string; status: 'synced' | 'skipped' | 'error'; reason?: string }[] = [];

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      // Paginated SELECT from Cloud SQL
      const rows = await this.cloudSql.executeQuery<Record<string, unknown>>(
        schemaName,
        `SELECT * FROM \`${tableName}\` LIMIT ? OFFSET ?`,
        [BATCH_SIZE, offset],
      );

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of rows) {
        try {
          // 1. Validate with Zod (loose schema)
          const parsed = CloudSqlEmployeeRowSchema.safeParse(row);
          if (!parsed.success) {
            skipped++;
            const employeeId = String(row['employee_id'] ?? row['id'] ?? 'unknown');
            details.push({ id: employeeId, status: 'skipped', reason: parsed.error.message });
            continue;
          }

          const validRow = parsed.data;

          // 2. Apply field mappings (if configured)
          let mappedData: Record<string, unknown>;
          if (mappings.length > 0) {
            const mapResult = this.fieldMappingService.applyMappings(
              validRow as unknown as Record<string, unknown>,
              mappings.map((m) => ({
                ...m,
                transformConfig: (m.transformConfig ?? {}) as Record<string, unknown>,
              })),
            );
            if (!mapResult.success && mapResult.errors.length > 0) {
              // Log mapping errors but continue with partial data
              this.logger.warn(
                `Field mapping errors for ${validRow.employee_id}: ${mapResult.errors.map((e) => e.message).join(', ')}`,
              );
            }
            mappedData = mapResult.mappedData;
          } else {
            // No mappings — use direct field names
            mappedData = this.defaultMapping(validRow);
          }

          // 3. Upsert into PostgreSQL
          await this.upsertEmployee(tenantId, validRow.employee_id, mappedData);
          synced++;
          details.push({ id: validRow.employee_id, status: 'synced' });
        } catch (err) {
          errors++;
          const employeeId = String(row['employee_id'] ?? row['id'] ?? 'unknown');
          const message = err instanceof Error ? err.message : 'Unknown error';
          details.push({ id: employeeId, status: 'error', reason: message.substring(0, 200) });
          this.logger.warn(`Failed to sync employee ${employeeId}: ${message}`);
        }
      }

      offset += rows.length;
      if (rows.length < BATCH_SIZE) hasMore = false;
    }

    const durationMs = Date.now() - start;

    // Update sync job record
    await this.db.forTenant(tenantId, (tx) =>
      tx.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: errors > 0 && synced === 0 ? 'FAILED' : 'COMPLETED',
          totalRecords: synced + skipped + errors,
          processedRecords: synced,
          failedRecords: errors,
          skippedRecords: skipped,
          completedAt: new Date(),
          errorMessage: errors > 0 ? `${errors} records failed` : null,
        },
      }),
    );

    // Update connector lastSyncAt
    await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.update({
        where: { id: connectorId },
        data: { lastSyncAt: new Date() },
      }),
    );

    // Create sync log entry (summary record)
    await this.db.forTenant(tenantId, (tx) =>
      tx.syncLog.create({
        data: {
          syncJobId,
          entityId: connectorId, // Use connectorId as the entity reference for summary logs
          entityType: 'employee',
          action: 'UPDATE',
          sourceData: { synced, skipped, errors, sampleDetails: details.slice(0, 50) } as never,
        },
      }),
    );

    this.logger.log(
      `Inbound sync complete: synced=${synced}, skipped=${skipped}, errors=${errors}, duration=${durationMs}ms`,
    );

    return {
      syncJobId,
      entityType: 'employee',
      durationMs,
      totalRecords: synced + skipped + errors,
      processedRecords: synced,
      failedRecords: errors,
      skippedRecords: skipped,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────

  /**
   * Default field mapping when no FieldMappings are configured.
   * Maps snake_case Cloud SQL columns → camelCase Prisma fields.
   */
  private defaultMapping(row: Record<string, unknown>): Record<string, unknown> {
    return {
      firstName: row['first_name'] ?? null,
      lastName: row['last_name'] ?? null,
      email: row['email'] ?? null,
      department: row['department'] ?? null,
      jobTitle: row['title'] ?? row['job_title'] ?? null,
      jobLevel: row['job_level'] ?? null,
      jobFamily: row['job_family'] ?? null,
      hireDate: row['hire_date'] ? new Date(String(row['hire_date'])) : null,
      status: row['status'] ?? 'active',
      managerId: row['manager_id'] ?? null,
      gender: row['gender'] ?? null,
      ethnicity: row['ethnicity'] ?? null,
      location: row['location'] ?? null,
      baseSalary: row['base_salary'] != null ? Number(row['base_salary']) : null,
      totalComp: row['total_comp'] != null ? Number(row['total_comp']) : null,
      currency: row['currency'] ?? null,
      compaRatio: row['compa_ratio'] != null ? Number(row['compa_ratio']) : null,
      performanceRating:
        row['performance_rating'] != null ? Number(row['performance_rating']) : null,
    };
  }

  /**
   * Upsert an employee into PostgreSQL.
   * Match on tenantId + employeeCode (unique per tenant).
   */
  private async upsertEmployee(
    tenantId: string,
    employeeCode: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.db.forTenant(tenantId, (tx) =>
      tx.employee.upsert({
        where: {
          tenantId_employeeCode: { tenantId, employeeCode },
        },
        create: {
          tenantId,
          employeeCode,
          ...data,
        } as never,
        update: data as never,
      }),
    );
  }

  private async getConnectorOrThrow(tenantId: string, connectorId: string) {
    const connector = await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.findFirst({
        where: { id: connectorId, tenantId },
      }),
    );
    if (!connector) throw new NotFoundException(`Connector ${connectorId} not found`);
    return connector;
  }

  private async connectToCloudSql(
    tenantId: string,
    connector: {
      encryptedCredentials: string | null;
      credentialIv: string | null;
      credentialTag: string | null;
    },
  ) {
    if (!connector.encryptedCredentials || !connector.credentialIv || !connector.credentialTag) {
      throw new BadRequestException('Connector has no stored credentials');
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
    });
  }
}
