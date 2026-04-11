import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CompportCloudSqlService } from './compport-cloudsql.service';
import { ConnectionManagerService } from './connection-manager.service';
import { CredentialVaultService } from '../../integrations/services/credential-vault.service';
import { FieldMappingService } from '../../integrations/services/field-mapping.service';
import { CloudSqlEmployeeRowSchema } from '../schemas/compport-data.schemas';

const BATCH_SIZE = 5000;
/** Per-Prisma-tx upsert chunk size. Smaller than BATCH_SIZE so each transaction
 *  finishes well within the per-tx timeout. */
const UPSERT_TX_CHUNK = 500;
/** Prisma transaction timeout for bulk upserts (5 minutes). The default 5s is
 *  way too low for batched upserts of hundreds of rows. */
const UPSERT_TX_TIMEOUT_MS = 5 * 60 * 1000;

/** Common timestamp column names in Compport MySQL schemas */
const TIMESTAMP_COLUMNS = ['updated_at', 'modified_date', 'modified_at', 'last_modified'];

/** Lookup tables from Compport manage_* tables: numeric ID → human-readable name */
interface LookupMaps {
  functions: Map<number, string>;
  levels: Map<number, string>;
  grades: Map<number, string>;
  designations: Map<number, string>;
  cities: Map<number, string>;
  subfunctions: Map<number, string>;
  employeeRoles: Map<number, string>;
  employeeTypes: Map<number, string>;
  costCenters: Map<number, string>;
  countries: Map<number, string>;
  businessLevel1: Map<number, string>;
  businessLevel2: Map<number, string>;
  businessLevel3: Map<number, string>;
  educations: Map<number, string>;
  roles: Map<number, string>;
}

export interface InboundSyncResult {
  syncJobId: string;
  entityType: string;
  durationMs: number;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  skippedRecords: number;
}

export interface RoleSyncResult {
  roles: { synced: number; errors: number };
  pages: { synced: number; errors: number };
  permissions: { synced: number; errors: number };
  users: { synced: number; linked: number; errors: number };
  durationMs: number;
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
    private readonly connectionManager: ConnectionManagerService,
    private readonly credentialVault: CredentialVaultService,
    private readonly fieldMappingService: FieldMappingService,
  ) {}

  /**
   * Sync all entities for a connector (employees + compensation).
   * Supports delta sync: only pulls records updated since last sync.
   */
  async syncAll(
    tenantId: string,
    connectorId: string,
    syncJobId: string,
    deltaOnly = false,
  ): Promise<InboundSyncResult> {
    const start = Date.now();
    const syncMode = deltaOnly ? 'delta' : 'full';
    this.logger.log(`Starting ${syncMode} inbound sync: tenant=${tenantId}, connector=${connectorId}`);

    const connector = await this.getConnectorOrThrow(tenantId, connectorId);
    const config = connector.config as Record<string, string>;
    const schemaName = config?.schemaName;
    const tableName = config?.tableName ?? 'employees';

    if (!schemaName) {
      throw new BadRequestException('Connector config missing schemaName');
    }

    // For delta sync, get the last successful sync timestamp
    let lastSyncAt: Date | null = null;
    if (deltaOnly && connector.lastSyncAt) {
      lastSyncAt = connector.lastSyncAt as Date;
    }

    // Connect to Cloud SQL
    await this.connectToCloudSql(tenantId, connector);

    // Load field mappings for this connector
    const mappings = await this.fieldMappingService.findByConnector(tenantId, connectorId);

    try {
      // Sync roles, pages, and permissions first (they don't depend on employees)
      const roleSyncResult = await this.syncRolesAndPermissions(tenantId, schemaName);
      this.logger.log(
        `Role sync complete: roles=${roleSyncResult.roles.synced}, pages=${roleSyncResult.pages.synced}, ` +
          `permissions=${roleSyncResult.permissions.synced}, users=${roleSyncResult.users.synced}`,
      );

      // Then sync employees
      const result = await this.syncEmployees(
        tenantId,
        connectorId,
        syncJobId,
        schemaName,
        tableName,
        mappings,
        lastSyncAt,
      );
      return result;
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  /**
   * Incremental sync: only fetches records changed since the last sync.
   * Uses the persistent ConnectionManager pool (no connect/disconnect per sync).
   * Falls back to full sync if no lastSyncAt exists for the connector.
   */
  async syncIncremental(tenantId: string, connectorId: string): Promise<InboundSyncResult> {
    const start = Date.now();
    const connector = await this.getConnectorOrThrow(tenantId, connectorId);
    const config = connector.config as Record<string, string>;
    const schemaName = config?.schemaName;
    const tableName = config?.tableName ?? 'employees';

    if (!schemaName) {
      throw new BadRequestException('Connector config missing schemaName');
    }

    const lastSyncAt = connector.lastSyncAt;
    const isFullSync = !lastSyncAt;

    // Create a SyncJob record for this incremental run
    const syncJob = await this.db.forTenant(tenantId, (tx) =>
      tx.syncJob.create({
        data: {
          tenantId,
          connectorId,
          direction: 'INBOUND',
          entityType: 'employee',
          status: 'RUNNING',
          metadata: {
            type: isFullSync ? 'full' : 'incremental',
            since: lastSyncAt?.toISOString() ?? null,
          } as never,
        },
      }),
    );

    this.logger.log(
      `Starting ${isFullSync ? 'FULL' : 'INCREMENTAL'} sync: tenant=${tenantId}, ` +
        `connector=${connectorId}, since=${lastSyncAt?.toISOString() ?? 'never'}`,
    );

    // If no lastSyncAt, fall back to full sync (with connect/disconnect)
    if (isFullSync) {
      return this.syncAll(tenantId, connectorId, syncJob.id);
    }

    // Use persistent connection pool for incremental sync
    const mappings = await this.fieldMappingService.findByConnector(tenantId, connectorId);

    try {
      // Detect which timestamp column exists in the table
      const timestampCol = await this.detectTimestampColumn(tenantId, schemaName, tableName);

      // Sync roles and permissions (always full — they're small)
      await this.ensureConnectionManagerConnected(tenantId);
      const roleSyncResult = await this.syncRolesAndPermissions(tenantId, schemaName);
      this.logger.log(
        `Role sync: roles=${roleSyncResult.roles.synced}, pages=${roleSyncResult.pages.synced}`,
      );

      // Sync only changed employees
      const result = await this.syncEmployeesIncremental(
        tenantId,
        connectorId,
        syncJob.id,
        schemaName,
        tableName,
        mappings,
        lastSyncAt,
        timestampCol,
      );

      return result;
    } catch (err) {
      // Update sync job as failed
      await this.db.forTenant(tenantId, (tx) =>
        tx.syncJob.update({
          where: { id: syncJob.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: (err as Error).message.substring(0, 500),
          },
        }),
      );
      throw err;
    }
  }

  /**
   * Sync only employees modified since a given timestamp.
   */
  private async syncEmployeesIncremental(
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
    since: Date,
    timestampCol: string,
  ): Promise<InboundSyncResult> {
    const start = Date.now();
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const details: { id: string; status: 'synced' | 'skipped' | 'error'; reason?: string }[] = [];

    const lookups = await this.loadLookupMaps(schemaName);

    // Delta sync MUST read the stored id column — never re-detect per run.
    // Context.md rule: "Delta sync reads stored value. NEVER re-detects."
    // We still need a fallback: if the connector hasn't been through a full
    // sync yet, detect and persist now.
    const idStrategy = await this.resolveIdColumn(
      this.cloudSql,
      schemaName,
      tableName,
      tenantId,
      connectorId,
    );
    if (!idStrategy.column || idStrategy.confidence < 0.95) {
      throw new Error(
        `Delta sync aborted: no stored idColumn and detection failed ` +
          `(confidence ${idStrategy.confidence.toFixed(3)}). Run a full sync first.`,
      );
    }
    this.logger.log(
      `Delta sync id column for "${tableName}" = "${idStrategy.column}" (source=${idStrategy.source})`,
    );

    let offset = 0;
    let hasMore = true;
    const nullSamples: Array<Record<string, unknown>> = [];
    // Owner-aware email dedupe (see syncEmployeesForTenant for rationale)
    const emailOwners = new Map<string, string>();
    let emailCollisions = 0;
    try {
      const existing = await this.db.forTenant(tenantId, (tx) =>
        tx.employee.findMany({
          where: { tenantId },
          select: { employeeCode: true, email: true },
        }),
      );
      for (const e of existing) {
        if (e.email) emailOwners.set(e.email.toLowerCase(), e.employeeCode);
      }
    } catch (err) {
      this.logger.warn(
        `[delta] Failed to pre-load existing emails: ${(err as Error).message?.substring(0, 120)}`,
      );
    }

    while (hasMore) {
      const rows = await this.connectionManager.executeQuery<Record<string, unknown>>(
        tenantId,
        schemaName,
        `SELECT * FROM \`${tableName}\` WHERE \`${timestampCol}\` > ? LIMIT ? OFFSET ?`,
        [since, BATCH_SIZE, offset],
      );

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of rows) {
        try {
          const parsed = CloudSqlEmployeeRowSchema.safeParse(row);
          if (!parsed.success) {
            skipped++;
            const rawId = row[idStrategy.column];
            details.push({
              id: rawId == null ? 'unknown' : String(rawId),
              status: 'skipped',
              reason: parsed.error.message,
            });
            continue;
          }

          const validRow = parsed.data;
          const raw = row[idStrategy.column];
          const employeeId = raw == null ? '' : String(raw).trim();
          if (!employeeId) {
            skipped++;
            if (nullSamples.length < 5) {
              nullSamples.push({ [idStrategy.column]: raw, offsetInSource: offset });
            }
            details.push({
              id: 'null',
              status: 'skipped',
              reason: `null/empty ${idStrategy.column}`,
            });
            continue;
          }

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
              this.logger.warn(
                `Field mapping errors for ${employeeId}: ${mapResult.errors.map((e) => e.message).join(', ')}`,
              );
            }
            mappedData = mapResult.mappedData;
          } else {
            mappedData = this.defaultMapping(validRow, lookups, employeeId);
          }

          // Owner-aware email dedupe — see syncEmployeesForTenant.
          const candidateEmail = String(mappedData['email'] ?? '');
          const lc = candidateEmail.toLowerCase();
          if (lc) {
            const owner = emailOwners.get(lc);
            if (owner && owner !== employeeId) {
              const [local, domain] = candidateEmail.split('@');
              const suffixed = `${local}+${employeeId}@${domain || 'imported.local'}`;
              mappedData['email'] = suffixed;
              emailOwners.set(suffixed.toLowerCase(), employeeId);
              emailCollisions++;
            } else {
              emailOwners.set(lc, employeeId);
            }
          }

          await this.upsertEmployee(tenantId, employeeId, mappedData);
          synced++;
          details.push({ id: employeeId, status: 'synced' });
        } catch (err) {
          errors++;
          const raw = row[idStrategy.column];
          const employeeId = raw == null ? 'unknown' : String(raw);
          details.push({
            id: employeeId,
            status: 'error',
            reason: (err as Error).message.substring(0, 200),
          });
        }
      }

      offset += rows.length;
      if (rows.length < BATCH_SIZE) hasMore = false;
    }

    if (emailCollisions > 0) {
      this.logger.warn(
        `Delta sync: ${emailCollisions} email collisions de-duplicated by suffixing with employeeId`,
      );
    }

    if (nullSamples.length > 0) {
      this.logger.warn(
        `Delta sync: rows skipped due to null/empty "${idStrategy.column}". First ${nullSamples.length} samples: ${JSON.stringify(nullSamples)}`,
      );
    }

    const durationMs = Date.now() - start;

    // Update sync job
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

    this.logger.log(
      `Incremental sync complete: synced=${synced}, skipped=${skipped}, errors=${errors}, duration=${durationMs}ms`,
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

  /**
   * Detect which timestamp column exists in a table.
   * Tries common column names: updated_at, modified_date, modified_at, last_modified.
   * Falls back to empty string if none found (full sync will be used).
   */
  private async detectTimestampColumn(
    tenantId: string,
    schemaName: string,
    tableName: string,
  ): Promise<string> {
    try {
      const columns = await this.connectionManager.executeQuery<{ Field: string }>(
        tenantId,
        schemaName,
        `DESCRIBE \`${tableName}\``,
      );
      const columnNames = columns.map((c) => c.Field.toLowerCase());

      for (const candidate of TIMESTAMP_COLUMNS) {
        if (columnNames.includes(candidate)) {
          this.logger.log(`Detected timestamp column: ${candidate} in ${schemaName}.${tableName}`);
          return candidate;
        }
      }

      this.logger.warn(
        `No timestamp column found in ${schemaName}.${tableName}, incremental sync unavailable`,
      );
      return 'updated_at'; // Default, query will handle gracefully
    } catch (err) {
      this.logger.warn(`Failed to detect timestamp column: ${(err as Error).message}`);
      return 'updated_at';
    }
  }

  /**
   * Ensure the persistent connection manager has a pool for this tenant.
   * Used by syncRolesAndPermissions which still uses cloudSql service internally.
   */
  private async ensureConnectionManagerConnected(tenantId: string): Promise<void> {
    if (!this.connectionManager.isConnected(tenantId)) {
      await this.connectionManager.connect(tenantId);
    }
    // Also ensure the legacy cloudSql service has a pool for roles sync
    if (!this.cloudSql.isConnected) {
      const connector = await this.db.forTenant(tenantId, (tx) =>
        tx.integrationConnector.findFirst({
          where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL', status: 'ACTIVE' },
        }),
      );
      if (connector) {
        await this.connectToCloudSql(tenantId, connector);
      }
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
    lastSyncAt?: Date | null,
  ): Promise<InboundSyncResult> {
    const start = Date.now();
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const details: { id: string; status: 'synced' | 'skipped' | 'error'; reason?: string }[] = [];

    // Pre-load lookup tables for resolving numeric FK IDs → human-readable names
    const lookups = await this.loadLookupMaps(schemaName);
    this.logger.log(
      `Loaded lookup maps: functions=${lookups.functions.size}, levels=${lookups.levels.size}, ` +
        `grades=${lookups.grades.size}, designations=${lookups.designations.size}, ` +
        `cities=${lookups.cities.size}, subfunctions=${lookups.subfunctions.size}`,
    );

    // Resolve the id column once at the top of the sync. Reads stored config
    // if present, else detects and persists. Same rule as syncEmployeesForTenant:
    // never use a fallback chain at extraction time.
    const idStrategy = await this.resolveIdColumn(
      this.cloudSql,
      schemaName,
      tableName,
      tenantId,
      connectorId,
    );
    this.logger.log(
      `Sync id column for "${tableName}" = "${idStrategy.column}" ` +
        `(confidence=${idStrategy.confidence.toFixed(3)}, source=${idStrategy.source})`,
    );
    if (!idStrategy.column || idStrategy.confidence < 0.95) {
      throw new Error(
        `No unique id column for ${schemaName}.${tableName} (confidence ${idStrategy.confidence.toFixed(3)}). Refusing to sync.`,
      );
    }

    // Stamp the sync job with the column we picked
    await this.db
      .forTenant(tenantId, (tx) =>
        tx.syncJob.update({
          where: { id: syncJobId },
          data: {
            metadata: {
              tableName,
              detectedIdColumn: idStrategy.column,
              idColumnConfidence: idStrategy.confidence,
              idColumnSource: idStrategy.source,
            } as never,
          },
        }),
      )
      .catch((err) =>
        this.logger.warn(
          `Failed to stamp SyncJob metadata: ${(err as Error).message?.substring(0, 120)}`,
        ),
      );

    let offset = 0;
    let hasMore = true;
    const nullSamples: Array<Record<string, unknown>> = [];
    // Owner-aware email dedupe (see syncEmployeesForTenant for rationale)
    const emailOwners = new Map<string, string>();
    let emailCollisions = 0;
    try {
      const existing = await this.db.forTenant(tenantId, (tx) =>
        tx.employee.findMany({
          where: { tenantId },
          select: { employeeCode: true, email: true },
        }),
      );
      for (const e of existing) {
        if (e.email) emailOwners.set(e.email.toLowerCase(), e.employeeCode);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to pre-load existing emails: ${(err as Error).message?.substring(0, 120)}`,
      );
    }

    while (hasMore) {
      // Paginated SELECT from Cloud SQL (with optional delta filter)
      let sql: string;
      let params: unknown[];
      if (lastSyncAt) {
        sql = `SELECT * FROM \`${tableName}\` WHERE \`updated_at\` >= ? ORDER BY \`updated_at\` ASC LIMIT ? OFFSET ?`;
        params = [lastSyncAt.toISOString().slice(0, 19).replace('T', ' '), BATCH_SIZE, offset];
      } else {
        sql = `SELECT * FROM \`${tableName}\` LIMIT ? OFFSET ?`;
        params = [BATCH_SIZE, offset];
      }
      const rows = await this.cloudSql.executeQuery<Record<string, unknown>>(
        schemaName,
        sql,
        params,
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
            const rawId = row[idStrategy.column];
            details.push({
              id: rawId == null ? 'unknown' : String(rawId),
              status: 'skipped',
              reason: parsed.error.message,
            });
            continue;
          }

          const validRow = parsed.data;

          // Resolve the employee identifier from the detected column ONLY.
          // No fallback chain — see context.md rule "use ONLY detected column".
          const raw = row[idStrategy.column];
          const employeeId = raw == null ? '' : String(raw).trim();
          if (!employeeId) {
            skipped++;
            if (nullSamples.length < 5) {
              nullSamples.push({ [idStrategy.column]: raw, offsetInSource: offset });
            }
            details.push({
              id: 'null',
              status: 'skipped',
              reason: `null/empty ${idStrategy.column}`,
            });
            continue;
          }

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
              this.logger.warn(
                `Field mapping errors for ${employeeId}: ${mapResult.errors.map((e) => e.message).join(', ')}`,
              );
            }
            mappedData = mapResult.mappedData;
          } else {
            // No mappings — use direct field names with lookup resolution
            mappedData = this.defaultMapping(validRow, lookups, employeeId);
          }

          // Owner-aware email dedupe — see syncEmployeesForTenant.
          const candidateEmail = String(mappedData['email'] ?? '');
          const lc = candidateEmail.toLowerCase();
          if (lc) {
            const owner = emailOwners.get(lc);
            if (owner && owner !== employeeId) {
              const [local, domain] = candidateEmail.split('@');
              const suffixed = `${local}+${employeeId}@${domain || 'imported.local'}`;
              mappedData['email'] = suffixed;
              emailOwners.set(suffixed.toLowerCase(), employeeId);
              emailCollisions++;
            } else {
              emailOwners.set(lc, employeeId);
            }
          }

          // 3. Upsert into PostgreSQL
          await this.upsertEmployee(tenantId, employeeId, mappedData);
          synced++;
          details.push({ id: employeeId, status: 'synced' });
        } catch (err) {
          errors++;
          const raw = row[idStrategy.column];
          const employeeId = raw == null ? 'unknown' : String(raw);
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
      `Inbound sync complete: synced=${synced}, skipped=${skipped}, errors=${errors}, emailCollisions=${emailCollisions}, duration=${durationMs}ms`,
    );
    if (nullSamples.length > 0) {
      this.logger.warn(
        `Rows skipped due to null/empty "${idStrategy.column}". First ${nullSamples.length} samples: ${JSON.stringify(nullSamples)}`,
      );
    }
    if (emailCollisions > 0) {
      this.logger.warn(
        `${emailCollisions} email collisions de-duplicated by suffixing with employeeId`,
      );
    }

    // Second pass: resolve manager relationships (employee_code → PG id)
    await this.resolveManagerRelationships(tenantId, schemaName, tableName);

    const totalDurationMs = Date.now() - start;

    return {
      syncJobId,
      entityType: 'employee',
      durationMs: totalDurationMs,
      totalRecords: synced + skipped + errors,
      processedRecords: synced,
      failedRecords: errors,
      skippedRecords: skipped,
    };
  }

  /**
   * Sync employees from Cloud SQL for a platform-admin-managed tenant.
   * Unlike syncEmployees(), this does NOT require a DataConnector or SyncJob —
   * it takes the schema/table directly and returns a summary.
   *
   * Assumes Cloud SQL connection is already established by the caller.
   */
  async syncEmployeesForTenant(
    tenantId: string,
    schemaName: string,
    tableName = 'employee_master',
    cloudSqlOverride?: CompportCloudSqlService,
    /** Optional jobId — if provided, processedRecords is updated live after each chunk. */
    jobId?: string,
    /** Optional connectorId — if provided, detected id column is persisted/read from config. */
    connectorId?: string,
  ): Promise<{ synced: number; skipped: number; errors: number; durationMs: number }> {
    const sql = cloudSqlOverride ?? this.cloudSql;
    const start = Date.now();
    let synced = 0;
    let skipped = 0;
    let errors = 0;

    const lookups = await this.loadLookupMaps(schemaName, sql);
    this.logger.log(
      `[tenant-sync] Loaded lookup maps: functions=${lookups.functions.size}, levels=${lookups.levels.size}`,
    );

    // ── Resolve id column (config cache → PK constraint → candidates) ──
    const idStrategy = await this.resolveIdColumn(
      sql,
      schemaName,
      tableName,
      tenantId,
      connectorId ?? null,
    );
    this.logger.log(
      `[tenant-sync] id column for "${tableName}" = "${idStrategy.column}" ` +
        `(distinct=${idStrategy.distinct}, total=${idStrategy.total}, ` +
        `confidence=${idStrategy.confidence.toFixed(3)}, source=${idStrategy.source})`,
    );

    // Hard stop: never proceed with a collapse-prone column. Per context.md:
    // "DO NOT PROCEED past this fix until Employee count ≈ source row count."
    // If confidence is below threshold we fail the sync so the operator sees it
    // instead of silently dropping 99% of rows.
    if (!idStrategy.column || idStrategy.confidence < 0.95) {
      throw new Error(
        `No unique id column found for ${schemaName}.${tableName} (best=${idStrategy.column || 'none'}, confidence=${idStrategy.confidence.toFixed(3)}). ` +
          `Refusing to sync — would collapse rows on unique index. ` +
          `Configure IntegrationConnector.config.idColumns['${tableName}'].column manually.`,
      );
    }

    // Write totalRecords + detected id column to SyncJob metadata so the
    // platform admin UI can show a real percentage and so ops can audit
    // which column was used for which sync run.
    if (jobId) {
      await this.db
        .forTenant(tenantId, (tx) =>
          tx.syncJob.update({
            where: { id: jobId },
            data: {
              totalRecords: idStrategy.total,
              entityType: 'full_sync',
              metadata: {
                type: 'full',
                source: 'platform-admin',
                phase: 'employees',
                tableName,
                detectedIdColumn: idStrategy.column,
                idColumnConfidence: idStrategy.confidence,
                idColumnDistinct: idStrategy.distinct,
                idColumnTotal: idStrategy.total,
                idColumnSource: idStrategy.source,
              } as never,
            },
          }),
        )
        .catch((err) =>
          this.logger.warn(
            `[tenant-sync] Failed to update SyncJob metadata: ${(err as Error).message?.substring(0, 120)}`,
          ),
        );
    }

    let offset = 0;
    let hasMore = true;
    const nullSamples: Array<Record<string, unknown>> = [];
    // Track emails seen across this entire sync run AND pre-existing rows
    // in PG. Employee schema has @@unique([tenantId, email]) so we MUST
    // dedupe against both sets or batches fail with "Unique constraint
    // failed" — see incident 2026-04-11 BFL login_user sync. Map value is
    // the employeeCode that owns the email; if the same employeeCode
    // shows up later (own row update) it passes through, otherwise we
    // suffix to avoid the collision.
    const emailOwners = new Map<string, string>();
    let emailCollisions = 0;
    try {
      const existing = await this.db.forTenant(tenantId, (tx) =>
        tx.employee.findMany({
          where: { tenantId },
          select: { employeeCode: true, email: true },
        }),
      );
      for (const e of existing) {
        if (e.email) emailOwners.set(e.email.toLowerCase(), e.employeeCode);
      }
      this.logger.log(
        `[tenant-sync] Pre-loaded ${emailOwners.size} existing email→employeeCode pairs for collision detection`,
      );
    } catch (err) {
      this.logger.warn(
        `[tenant-sync] Failed to pre-load existing emails: ${(err as Error).message?.substring(0, 120)}`,
      );
    }

    while (hasMore) {
      const rows = await sql.executeQuery<Record<string, unknown>>(
        schemaName,
        `SELECT * FROM \`${tableName}\` LIMIT ? OFFSET ?`,
        [BATCH_SIZE, offset],
      );

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      // Parse and map all rows in this batch using the detected id column.
      // NO fallback chain — per context.md rule "NEVER use ?? fallback chains
      // after detection. Use ONLY the detected column. Skip nulls. Log first 5."
      const batch: { employeeCode: string; data: Record<string, unknown> }[] = [];
      for (const row of rows) {
        try {
          const parsed = CloudSqlEmployeeRowSchema.safeParse(row);
          if (!parsed.success) {
            skipped++;
            continue;
          }

          const validRow = parsed.data;
          const raw = row[idStrategy.column];
          const employeeId = raw == null ? '' : String(raw).trim();
          if (!employeeId) {
            skipped++;
            if (nullSamples.length < 5) {
              nullSamples.push({
                [idStrategy.column]: raw,
                offsetInSource: offset,
              });
            }
            continue;
          }

          // Build mapped data using detected id for placeholder email uniqueness
          const data = this.defaultMapping(validRow, lookups, employeeId);

          // Owner-aware email dedupe. Map tracks email → employeeCode that
          // currently owns it (across both pre-existing PG rows and rows
          // already processed in this run). If a new row's email belongs to
          // a DIFFERENT employeeCode, suffix it so the unique index doesn't
          // collide. If it belongs to the same employeeCode, it's the same
          // row being updated — pass through unchanged.
          const candidateEmail = String(data['email'] ?? '');
          const lc = candidateEmail.toLowerCase();
          if (lc) {
            const owner = emailOwners.get(lc);
            if (owner && owner !== employeeId) {
              const [local, domain] = candidateEmail.split('@');
              const suffixed = `${local}+${employeeId}@${domain || 'imported.local'}`;
              data['email'] = suffixed;
              emailOwners.set(suffixed.toLowerCase(), employeeId);
              emailCollisions++;
            } else {
              emailOwners.set(lc, employeeId);
            }
          }

          batch.push({ employeeCode: employeeId, data });
        } catch (err) {
          errors++;
          const message = err instanceof Error ? err.message : 'Unknown error';
          this.logger.warn(`[tenant-sync] Failed to parse employee: ${message.substring(0, 200)}`);
        }
      }

      // Upsert in smaller chunks per transaction so each tx finishes well
      // within the Prisma transaction timeout. Default 5000ms is way too low
      // for hundreds of upserts; we explicitly bump the timeout for safety.
      if (batch.length > 0) {
        for (let i = 0; i < batch.length; i += UPSERT_TX_CHUNK) {
          const chunk = batch.slice(i, i + UPSERT_TX_CHUNK);
          try {
            await this.db.forTenant(
              tenantId,
              async (tx) => {
                for (const { employeeCode, data } of chunk) {
                  await tx.employee.upsert({
                    where: { tenantId_employeeCode: { tenantId, employeeCode } },
                    create: { tenantId, employeeCode, ...data } as never,
                    update: data as never,
                  });
                }
              },
              { timeout: UPSERT_TX_TIMEOUT_MS, maxWait: 30_000 },
            );
            synced += chunk.length;
          } catch (err) {
            // Per-row recovery: when the batched transaction fails,
            // retry each row in its own transaction so a single bad
            // row never kills the other 499. This is the slow path
            // (~1 tx per row instead of ~1 tx per 500), but only
            // fires on the rare chunks that fail in the fast path.
            const message = err instanceof Error ? err.message : 'Unknown error';
            this.logger.warn(
              `[tenant-sync] Chunk ${i}-${i + chunk.length} failed (${message.substring(0, 100)}); falling back to per-row retry`,
            );
            for (const { employeeCode, data } of chunk) {
              try {
                await this.db.forTenant(
                  tenantId,
                  async (tx) => {
                    await tx.employee.upsert({
                      where: { tenantId_employeeCode: { tenantId, employeeCode } },
                      create: { tenantId, employeeCode, ...data } as never,
                      update: data as never,
                    });
                  },
                  { timeout: 30_000, maxWait: 10_000 },
                );
                synced++;
              } catch (rowErr) {
                errors++;
                const rowMsg = rowErr instanceof Error ? rowErr.message : 'Unknown';
                this.logger.error(
                  `[tenant-sync] Row failed (employeeCode=${employeeCode}): ${rowMsg.substring(0, 200)}`,
                );
              }
            }
          }

          // Live progress: update processedRecords on the SyncJob row so
          // both platform admin and the tenant-side banner see the count
          // climbing in real time.
          if (jobId) {
            const progress = synced;
            const errCount = errors;
            await this.db
              .forTenant(tenantId, (tx) =>
                tx.syncJob.update({
                  where: { id: jobId },
                  data: { processedRecords: progress, failedRecords: errCount },
                }),
              )
              .catch(() => {
                /* progress updates are best-effort */
              });
          }
        }
      }

      offset += rows.length;
      if (rows.length < BATCH_SIZE) hasMore = false;
    }

    const durationMs = Date.now() - start;
    this.logger.log(
      `[tenant-sync] Employee sync complete: synced=${synced}, skipped=${skipped}, errors=${errors}, emailCollisions=${emailCollisions}, duration=${durationMs}ms`,
    );
    if (nullSamples.length > 0) {
      this.logger.warn(
        `[tenant-sync] ${skipped} rows skipped due to null/empty "${idStrategy.column}". First ${nullSamples.length} samples: ${JSON.stringify(nullSamples)}`,
      );
    }
    if (emailCollisions > 0) {
      this.logger.warn(
        `[tenant-sync] ${emailCollisions} email collisions de-duplicated by suffixing with employeeId`,
      );
    }

    // Resolve manager relationships
    await this.resolveManagerRelationships(tenantId, schemaName, tableName, sql);

    return { synced, skipped, errors, durationMs: Date.now() - start };
  }

  /**
   * BLOCKER 4 (context.md): User→Employee linking pass.
   *
   * The role/permission sync deliberately skips populating User.employeeId
   * for performance ("skipping employee link for perf"). This breaks Copilot
   * MANAGER and EMPLOYEE scoping which both rely on User.employeeId.
   *
   * This pass runs AFTER both employee and user syncs complete. It:
   *   1. Reads (employee_code, email) pairs from Cloud SQL login_user
   *   2. Looks up each Employee.id by employeeCode in Postgres
   *   3. Batches UPDATE User SET employeeId in chunks of 500
   *   4. Logs link rate — WARNs if < 80%
   */
  async linkUsersToEmployees(
    tenantId: string,
    schemaName: string,
    cloudSqlOverride?: CompportCloudSqlService,
  ): Promise<{
    candidates: number;
    linked: number;
    notFound: number;
    durationMs: number;
  }> {
    const sql = cloudSqlOverride ?? this.cloudSql;
    const start = Date.now();

    // Step 1: load (employee_code, email) pairs from Cloud SQL.
    // CRITICAL: The user sync builds the User.email from
    //   email = row.email?.trim() || `${employeeCode}@compport.local`
    // so we MUST do the same here, otherwise the join misses every
    // row that had no real email.
    let pairs: { employeeCode: string; userEmail: string }[] = [];
    try {
      const rows = await sql.executeQuery<{
        employee_code: string | null;
        email: string | null;
      }>(schemaName, 'SELECT employee_code, email FROM `login_user`');
      pairs = rows
        .map((r) => {
          const employeeCode = (r.employee_code ?? '').toString().trim();
          const realEmail = (r.email ?? '').toString().trim();
          // Mirror the synthesis used by the user sync exactly — same
          // case-preserving logic, otherwise the WHERE clause misses
          // every row whose email contains uppercase letters.
          const userEmail = realEmail || `${employeeCode}@compport.local`;
          return { employeeCode, userEmail };
        })
        .filter((p) => p.employeeCode && p.userEmail);
    } catch (err) {
      this.logger.error(
        `[link] Failed to read login_user for ${tenantId}: ${(err as Error).message?.substring(0, 200)}`,
      );
      return { candidates: 0, linked: 0, notFound: 0, durationMs: Date.now() - start };
    }

    if (pairs.length === 0) {
      this.logger.warn(`[link] No (employee_code, email) pairs found in login_user`);
      return { candidates: 0, linked: 0, notFound: 0, durationMs: Date.now() - start };
    }

    // Step 2: build employeeCode → Employee.id map for this tenant
    const employees = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.findMany({
        where: { tenantId },
        select: { id: true, employeeCode: true },
      }),
    );
    const codeToId = new Map<string, string>();
    for (const e of employees) {
      if (e.employeeCode) codeToId.set(e.employeeCode, e.id);
    }

    // Step 3: dedupe BOTH by email AND by employeeId.
    //
    // - Email dedupe: the User table has @@unique([tenantId, email]), so
    //   multiple login_user rows can collapse to one User row. Pick first.
    //
    // - employeeId dedupe: User.employeeId is @unique. For a given Employee
    //   only ONE User can ever be linked. If two distinct user emails map
    //   to the same Employee (e.g. shared admin accounts in BFL), only the
    //   first link succeeds — the second hits the unique constraint and
    //   aborts the surrounding transaction.
    //
    // Doing both deduplications up front means the actual UPDATE loop has
    // exactly one (email, employeeId) pair per Employee, so there's nothing
    // left for Postgres to reject.
    const emailToEmployeeId = new Map<string, string>();
    const claimedEmployeeIds = new Set<string>();
    let notFound = 0;
    let multiUserDropped = 0;
    for (const { employeeCode, userEmail } of pairs) {
      const employeeId = codeToId.get(employeeCode);
      if (!employeeId) {
        notFound++;
        continue;
      }
      if (emailToEmployeeId.has(userEmail)) continue; // already mapped this email
      if (claimedEmployeeIds.has(employeeId)) {
        // Two distinct emails want this Employee — first wins, drop the rest
        multiUserDropped++;
        continue;
      }
      emailToEmployeeId.set(userEmail, employeeId);
      claimedEmployeeIds.add(employeeId);
    }

    this.logger.log(
      `[link] Loaded ${codeToId.size} employees, ${pairs.length} login_user pairs, ` +
        `${emailToEmployeeId.size} unique pairs to link ` +
        `(notFound=${notFound}, multiUserDropped=${multiUserDropped})`,
    );

    // Step 4: bulk UPDATE in chunks via raw SQL.
    //
    // Why raw SQL instead of Prisma updateMany: we already deduped to one
    // (email, employeeId) per Employee in step 3, so the unique index
    // can no longer trip. The remaining concern is throughput — Prisma
    // updateMany executes one statement per row, slow for 123K rows.
    // A single raw UPDATE … FROM (VALUES …) handles a whole chunk in
    // one round-trip.
    //
    // We chunk to keep parameter counts reasonable (Postgres caps at
    // ~32K parameters per statement; 1000 rows × 2 params = 2000).
    let linked = 0;
    let conflicts = 0;
    const updates = Array.from(emailToEmployeeId.entries());
    const CHUNK = 1000;

    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      // Build VALUES list: ($1, $2), ($3, $4), …
      const valuesSql = chunk.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(', ');
      const params: string[] = [];
      for (const [email, employeeId] of chunk) {
        params.push(email, employeeId);
      }
      // tenantId param goes at the end
      params.push(tenantId);
      const tenantParamIdx = params.length;

      try {
        await this.db.forTenant(
          tenantId,
          async (tx) => {
            const result = await tx.$executeRawUnsafe<number>(
              `UPDATE "users" u
                  SET "employeeId" = v.employee_id
                 FROM (VALUES ${valuesSql}) AS v(email, employee_id)
                WHERE u."email" = v.email
                  AND u."tenantId" = $${tenantParamIdx}
                  AND u."employeeId" IS NULL`,
              ...params,
            );
            // $executeRawUnsafe returns number of rows affected
            linked += Number(result) || 0;
          },
          { timeout: 60_000, maxWait: 10_000 },
        );
      } catch (e) {
        conflicts++;
        const msg = (e as Error).message?.substring(0, 150);
        this.logger.warn(`[link] Chunk ${i}-${i + chunk.length} failed: ${msg}`);
        // Per-row recovery for chunks that fail (e.g. one row hits a
        // last-minute concurrent insert that violates the unique index)
        for (const [email, employeeId] of chunk) {
          try {
            const r = await this.db.forTenant(
              tenantId,
              (tx) =>
                tx.user.updateMany({
                  where: { tenantId, email, employeeId: null },
                  data: { employeeId },
                }),
              { timeout: 5_000, maxWait: 2_000 },
            );
            if (r.count > 0) linked += r.count;
          } catch {
            /* per-row failure already counted in chunk-level conflicts */
          }
        }
      }
    }

    const durationMs = Date.now() - start;
    const denominator = emailToEmployeeId.size;
    const linkRate = denominator > 0 ? linked / denominator : 0;
    const msg = `[link] Linked ${linked}/${denominator} unique users to employees (sourcePairs=${pairs.length}, employeeNotFound=${notFound}, conflicts=${conflicts}, rate=${(linkRate * 100).toFixed(1)}%, duration=${durationMs}ms)`;
    if (linkRate < 0.8) {
      this.logger.warn(msg);
    } else {
      this.logger.log(msg);
    }

    return { candidates: denominator, linked, notFound, durationMs };
  }

  /**
   * BLOCKER 6 (context.md): compensation table discovery.
   *
   * Compport tenant schemas vary in which compensation/performance tables
   * they expose. Run this once per tenant to find out which tables exist,
   * then store the result in IntegrationConnector.config.availableTables.
   * The compensation sync logic (TBD) will then know which tables to read.
   *
   * Returns a map keyed by category (salary/revision/perf/band/variable)
   * with the discovered table names and their estimated row counts.
   */
  async discoverCompensationTables(
    tenantId: string,
    schemaName: string,
    cloudSqlOverride?: CompportCloudSqlService,
    connectorId?: string,
  ): Promise<{
    salary: Array<{ name: string; rowCount: number }>;
    revision: Array<{ name: string; rowCount: number }>;
    performance: Array<{ name: string; rowCount: number }>;
    band: Array<{ name: string; rowCount: number }>;
    variable: Array<{ name: string; rowCount: number }>;
    other: Array<{ name: string; rowCount: number }>;
  }> {
    const sql = cloudSqlOverride ?? this.cloudSql;

    const candidatesByCategory: Record<string, string[]> = {
      salary: [
        'salary_details',
        'ctc_details',
        'compensation_details',
        'current_ctc',
        'emp_salary',
        'salary_master',
        'employee_compensation',
      ],
      revision: [
        'revision_history',
        'increment_history',
        'salary_history',
        'comp_history',
        'ctc_history',
        'salary_revision',
        'compensation_revision',
      ],
      performance: [
        'performance_ratings',
        'appraisal_data',
        'kpi_scores',
        'performance_history',
        'appraisal_history',
      ],
      band: ['grade_band', 'salary_bands', 'pay_grades', 'compensation_bands'],
      variable: [
        'variable_pay',
        'bonus_details',
        'incentive_details',
        'variable_pay_details',
        'bonus_history',
      ],
      other: ['increment_matrix', 'merit_matrix'],
    };

    const allCandidates = Object.values(candidatesByCategory).flat();

    // One INFORMATION_SCHEMA query for everything
    const placeholders = allCandidates.map(() => '?').join(', ');
    let foundTables: Array<{ TABLE_NAME: string; TABLE_ROWS: number | string | null }> = [];
    try {
      foundTables = await sql.executeQuery<{
        TABLE_NAME: string;
        TABLE_ROWS: number | string | null;
      }>(
        schemaName,
        `SELECT TABLE_NAME, TABLE_ROWS
           FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME IN (${placeholders})`,
        [schemaName, ...allCandidates],
      );
    } catch (err) {
      this.logger.error(
        `[discover] INFORMATION_SCHEMA query failed: ${(err as Error).message?.substring(0, 200)}`,
      );
      throw err;
    }

    // Build map and bucketize
    const foundMap = new Map<string, number>();
    for (const t of foundTables) {
      foundMap.set(String(t.TABLE_NAME), Number(t.TABLE_ROWS ?? 0) || 0);
    }

    const bucket = (cands: string[]) =>
      cands
        .filter((c) => foundMap.has(c))
        .map((c) => ({ name: c, rowCount: foundMap.get(c) ?? 0 }));

    const result = {
      salary: bucket(candidatesByCategory['salary']!),
      revision: bucket(candidatesByCategory['revision']!),
      performance: bucket(candidatesByCategory['performance']!),
      band: bucket(candidatesByCategory['band']!),
      variable: bucket(candidatesByCategory['variable']!),
      other: bucket(candidatesByCategory['other']!),
    };

    const totalFound = Object.values(result).reduce((sum, arr) => sum + arr.length, 0);
    this.logger.log(
      `[discover] ${schemaName}: found ${totalFound} compensation tables ` +
        `(salary=${result.salary.length}, revision=${result.revision.length}, ` +
        `performance=${result.performance.length}, band=${result.band.length}, ` +
        `variable=${result.variable.length}, other=${result.other.length})`,
    );

    // Persist into connector config for later sync use
    if (connectorId) {
      try {
        const current = await this.db.forTenant(tenantId, (tx) =>
          tx.integrationConnector.findFirst({
            where: { id: connectorId, tenantId },
            select: { config: true },
          }),
        );
        const cfg = ((current?.config as Record<string, unknown> | null) ?? {}) as Record<
          string,
          unknown
        >;
        cfg['availableCompTables'] = result;
        cfg['compTablesDiscoveredAt'] = new Date().toISOString();
        await this.db.forTenant(tenantId, (tx) =>
          tx.integrationConnector.update({
            where: { id: connectorId },
            data: { config: cfg as never },
          }),
        );
      } catch (err) {
        this.logger.warn(
          `[discover] Failed to persist availableCompTables: ${(err as Error).message?.substring(0, 120)}`,
        );
      }
    }

    return result;
  }

  // ─── Private Helpers ─────────────────────────────────────────

  /**
   * Default field mapping when no FieldMappings are configured.
   * Maps Cloud SQL columns → camelCase Prisma Employee fields.
   *
   * Handles both standard schemas (first_name, last_name, employee_id)
   * and Compport legacy schemas (name, employee_code, login_user table).
   *
   * Uses pre-loaded lookup maps to resolve numeric FK IDs to human-readable names.
   */
  private defaultMapping(
    row: Record<string, unknown>,
    lookups: LookupMaps,
    /** Unique row identifier extracted from the detected id column. Used to
     *  build a placeholder email when the source row has no real one — must
     *  be unique across the sync so the @@unique([tenantId, email]) index
     *  doesn't collide. Falls back to the legacy chain only when not provided. */
    rowUniqueId?: string,
  ): Record<string, unknown> {
    // Helper: resolve a numeric FK ID using a lookup map, fallback to string
    const resolve = (map: Map<number, string>, val: unknown): string | null => {
      if (val == null || val === '' || val === 0) return null;
      const id = typeof val === 'number' ? val : Number(val);
      if (isNaN(id)) return String(val);
      return map.get(id) ?? String(val);
    };

    // Handle name: split "name" into firstName/lastName if first_name not present
    let firstName = row['first_name'] as string | null;
    let lastName = row['last_name'] as string | null;
    if (!firstName && row['name']) {
      const nameParts = String(row['name']).trim().split(/\s+/);
      firstName = nameParts[0] ?? null;
      lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;
    }

    // Handle email: Compport sometimes stores employee_code as email
    let email = row['email'] as string | null;
    if (email && !email.includes('@')) {
      // Not a real email — construct a placeholder
      email = null;
    }

    // Handle hire date: check both hire_date and company_joining_date
    // MySQL2 returns Date objects for datetime columns, so handle both Date and string
    const hireDateRaw = row['hire_date'] ?? row['company_joining_date'];
    const hireDate =
      hireDateRaw instanceof Date
        ? hireDateRaw
        : hireDateRaw
          ? new Date(String(hireDateRaw))
          : null;

    // Handle status: Compport uses numeric 1=active, others may be string
    const rawStatus = row['status'];
    let status: string;
    if (typeof rawStatus === 'number') {
      status = rawStatus === 1 ? 'active' : 'inactive';
    } else {
      status = String(rawStatus ?? 'active');
    }

    // Handle salary: check base_salary, current_base_salary, and assignment_based_salary
    // Use a helper that treats 0 / "0.00" / null as "no data" so we fall through to the next source
    const nonZero = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return isNaN(n) || n === 0 ? null : n;
    };
    const baseSalary =
      nonZero(row['base_salary']) ??
      nonZero(row['current_base_salary']) ??
      nonZero(row['assignment_based_salary']);

    // Coerce all values to appropriate Prisma types (many Compport fields are numeric FK IDs)
    const toStr = (v: unknown): string | null =>
      v != null && v !== '' && v !== 0 ? String(v) : null;

    // Strip Compport internal code suffixes like "(BFDL_BFSD_SL_SAL)" from lookup names
    const stripCodeSuffix = (name: string | null): string | null =>
      name ? name.replace(/\s*\([A-Z0-9_]+\)\s*$/, '').trim() || name : null;

    // Resolve FK IDs to human-readable names via lookup maps
    const department =
      stripCodeSuffix(resolve(lookups.functions, row['function'])) ??
      toStr(row['department']) ??
      'Unknown';
    const level =
      resolve(lookups.levels, row['level']) ?? resolve(lookups.grades, row['grade']) ?? 'Unknown';
    // City names in Compport are stored as "CityName|BranchCode" — extract just the city name
    const rawCity = resolve(lookups.cities, row['city']) ?? toStr(row['location']) ?? null;
    const location = rawCity?.split('|')[0]?.trim() ?? null;
    const jobFamily =
      stripCodeSuffix(resolve(lookups.subfunctions, row['subfunction'])) ??
      toStr(row['job_family']) ??
      null;
    const designationName = resolve(lookups.designations, row['designation']);
    const gradeName = resolve(lookups.grades, row['grade']);

    // Resolve additional lookups
    const employeeTypeName = resolve(lookups.employeeTypes, row['employee_type']);
    const employeeRoleName = resolve(lookups.employeeRoles, row['employee_role']);
    const costCenterName = resolve(lookups.costCenters, row['cost_center']);
    const countryName = resolve(lookups.countries, row['country']);
    const bl1Name = stripCodeSuffix(resolve(lookups.businessLevel1, row['business_level_1']));
    const bl2Name = stripCodeSuffix(resolve(lookups.businessLevel2, row['business_level_2']));
    const bl3Name = stripCodeSuffix(resolve(lookups.businessLevel3, row['business_level_3']));
    const educationName = resolve(lookups.educations, row['education']);
    const systemRoleName = resolve(lookups.roles, row['role']);

    // Handle termination date: Compport uses 1899-11-30 as a null sentinel
    const termDateRaw = row['termination_date'];
    let terminationDate: Date | null = null;
    if (termDateRaw != null) {
      const td = termDateRaw instanceof Date ? termDateRaw : new Date(String(termDateRaw));
      if (!isNaN(td.getTime()) && td.getFullYear() > 1900) {
        terminationDate = td;
      }
    }

    // Handle totalComp: prefer total_compensation over total_comp
    const totalCompRaw = row['total_compensation'] ?? row['total_comp'];
    const totalComp = totalCompRaw != null ? Number(totalCompRaw) : (baseSalary ?? 0);

    // Performance rating: prefer rating_for_current_year over performance_rating
    const perfRatingRaw = row['rating_for_current_year'] ?? row['performance_rating'];
    const performanceRating = perfRatingRaw != null ? Number(perfRatingRaw) : null;

    // Email placeholder: must be unique across the sync. Use the detected id
    // column (always unique by definition) when available; fall back to the
    // legacy chain only for callsites that haven't been threaded yet.
    const fallbackId =
      rowUniqueId ??
      String(row['employee_code'] ?? row['employee_id'] ?? row['id'] ?? 'unknown');
    return {
      firstName: firstName ?? 'Unknown',
      lastName: lastName ?? '',
      email: email ?? `${fallbackId}@imported.local`,
      department,
      jobFamily,
      level,
      hireDate: hireDate && !isNaN(hireDate.getTime()) ? hireDate : new Date('2020-01-01'),
      terminationDate,
      managerId: null, // manager_name in Compport is an employee_code, not a PG id
      gender: toStr(row['gender']),
      location,
      baseSalary: baseSalary ?? 0,
      totalComp,
      currency: typeof row['currency'] === 'string' ? row['currency'] : 'INR',
      compaRatio: row['compa_ratio'] != null ? Number(row['compa_ratio']) : null,
      performanceRating,
      isPeopleManager: row['is_manager'] === 1 || row['is_manager'] === true,
      // Store original Compport data in metadata for reference
      metadata: {
        compportId: row['id'],
        compportStatus: status,
        managerCode: row['manager_name'],
        // Designation / job
        designationId: row['designation'],
        designationName,
        jobTitle:
          designationName ??
          toStr(row['title']) ??
          toStr(row['job_title']) ??
          toStr(row['designation']),
        jobCode: toStr(row['job_code']),
        jobName: toStr(row['job_name']),
        // Grade / level IDs
        gradeId: row['grade'],
        gradeName,
        functionId: row['function'],
        functionName: resolve(lookups.functions, row['function']),
        // Geography
        cityId: row['city'],
        cityName: resolve(lookups.cities, row['city']),
        countryId: row['country'],
        countryName,
        // Hierarchy / business levels
        businessLevel1: bl1Name,
        businessLevel2: bl2Name,
        businessLevel3: bl3Name,
        // Employee classification
        employeeTypeId: row['employee_type'],
        employeeType: employeeTypeName,
        employeeRoleId: row['employee_role'],
        employeeRole: employeeRoleName,
        systemRoleId: row['role'],
        systemRole: systemRoleName,
        costCenterId: row['cost_center'],
        costCenter: costCenterName,
        educationId: row['education'],
        education: educationName,
        companyName: toStr(row['company_name']),
        // Approver chain
        approver1: toStr(row['approver_1']),
        approver2: toStr(row['approver_2']),
        approver3: toStr(row['approver_3']),
        approver4: toStr(row['approver_4']),
        // Talent flags
        criticalTalent: row['critical_talent'] != null ? Number(row['critical_talent']) : null,
        criticalPosition:
          row['critical_position'] != null ? Number(row['critical_position']) : null,
        specialCategory: row['special_category'] != null ? Number(row['special_category']) : null,
        // Tenure
        tenureCompany: row['tenure_company'] != null ? Number(row['tenure_company']) : null,
        tenureRole: row['tenure_role'] != null ? Number(row['tenure_role']) : null,
        recentlyPromoted: toStr(row['recently_promoted']),
        // Ratings
        ratingCurrentYear:
          row['rating_for_current_year'] != null ? Number(row['rating_for_current_year']) : null,
        ratingLastYear:
          row['rating_for_last_year'] != null ? Number(row['rating_for_last_year']) : null,
        // Compensation details
        targetBonus:
          row['current_target_bonus'] != null ? Number(row['current_target_bonus']) : null,
        // Termination
        terminationCategory: toStr(row['termination_category']),
        terminationReason: toStr(row['termination_reason']),
      },
    };
  }

  /**
   * Auto-detect the unique-identifier column for a Compport employee table.
   *
   * Compport schemas vary per tenant — some use `employee_code`, some
   * `emp_master_id`, some a random-named PK. Picking a non-unique column
   * collapses 121K rows into 161 on the PG unique index (the BFL bug).
   *
   * Strategy (in order):
   *   1. Query INFORMATION_SCHEMA.KEY_COLUMN_USAGE for the actual
   *      PRIMARY KEY constraint. If it's a single-column PK and
   *      distinct/total ratio on the PG side is 100%, use it.
   *   2. Fall back to an extended candidate list, probing each with
   *      COUNT(DISTINCT) and COUNT(col IS NOT NULL). Accept the first
   *      column that passes ratio ≥ 0.95 AND has zero nulls.
   *   3. If nothing passes, return the best column found with
   *      confidence < 0.95 and log a WARNING — caller decides whether
   *      to proceed.
   */
  private async detectEmployeeIdColumn(
    sql: CompportCloudSqlService,
    schemaName: string,
    tableName: string,
  ): Promise<{
    column: string;
    distinct: number;
    total: number;
    confidence: number;
    source: 'pk' | 'candidate' | 'fallback';
  }> {
    // ── Step 1: total row count ─────────────────────────────
    let total = 0;
    try {
      const totalRows = await sql.executeQuery<{ c: number | string }>(
        schemaName,
        `SELECT COUNT(*) AS c FROM \`${tableName}\``,
      );
      total = Number(totalRows[0]?.c ?? 0) || 0;
    } catch (err) {
      this.logger.warn(
        `[tenant-sync] Failed to count rows in ${tableName}: ${(err as Error).message?.substring(0, 120)}`,
      );
      return {
        column: '',
        distinct: 0,
        total: 0,
        confidence: 0,
        source: 'fallback',
      };
    }

    if (total === 0) {
      return { column: '', distinct: 0, total: 0, confidence: 0, source: 'fallback' };
    }

    // ── Step 2: Query actual PRIMARY KEY from INFORMATION_SCHEMA ──
    // Single-column PKs are the gold standard — if MySQL says it's a PK,
    // it's guaranteed unique and non-null.
    try {
      const pkRows = await sql.executeQuery<{ COLUMN_NAME: string }>(
        schemaName,
        `SELECT COLUMN_NAME
           FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = ?
            AND TABLE_NAME = ?
            AND CONSTRAINT_NAME = 'PRIMARY'
          ORDER BY ORDINAL_POSITION`,
        [schemaName, tableName],
      );
      if (pkRows.length === 1) {
        const pkCol = String(pkRows[0]!.COLUMN_NAME);
        // Sanity check: MySQL PK is guaranteed unique + non-null, but we still
        // run COUNT(DISTINCT) to confirm (and to populate the metadata field
        // we write to SyncJob).
        try {
          const rows = await sql.executeQuery<{ d: number | string }>(
            schemaName,
            `SELECT COUNT(DISTINCT \`${pkCol}\`) AS d FROM \`${tableName}\``,
          );
          const distinct = Number(rows[0]?.d ?? 0) || 0;
          this.logger.log(
            `[tenant-sync] PK detection: ${tableName}.${pkCol} distinct=${distinct}/${total}`,
          );
          if (distinct === total) {
            return {
              column: pkCol,
              distinct,
              total,
              confidence: 1,
              source: 'pk',
            };
          }
          // PK exists but isn't perfectly unique (extremely rare; indicates
          // orphaned rows or a composite constraint misreported). Fall
          // through to candidate probing.
          this.logger.warn(
            `[tenant-sync] ${tableName}.${pkCol} is PK but distinct (${distinct}) != total (${total}). Falling back.`,
          );
        } catch (e) {
          this.logger.warn(
            `[tenant-sync] PK ${pkCol} COUNT(DISTINCT) failed: ${(e as Error).message?.substring(0, 120)}`,
          );
        }
      } else if (pkRows.length > 1) {
        this.logger.log(
          `[tenant-sync] ${tableName} has composite PK (${pkRows
            .map((r) => r.COLUMN_NAME)
            .join('+')}). Skipping PK path.`,
        );
      } else {
        this.logger.log(`[tenant-sync] ${tableName} has no PRIMARY KEY. Skipping PK path.`);
      }
    } catch (err) {
      this.logger.warn(
        `[tenant-sync] KEY_COLUMN_USAGE probe failed: ${(err as Error).message?.substring(0, 120)}`,
      );
    }

    // ── Step 3: Get the actual column list so candidate probing only
    // touches columns that exist ────────────────────────────────
    let existingColumns: string[] = [];
    try {
      const cols = await sql.executeQuery<{ COLUMN_NAME: string }>(
        schemaName,
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [schemaName, tableName],
      );
      existingColumns = cols.map((c) => String(c.COLUMN_NAME));
    } catch {
      /* fall through */
    }

    // ── Step 4: Extended candidate list ─────────────────────
    // Compport and upstream HRIS schemas use many naming conventions.
    // Order is hint only — we pick the first column that passes the
    // strict uniqueness test.
    const candidates = [
      'employee_id',
      'emp_id',
      'emp_no',
      'emp_code',
      'emp_master_id',
      'employee_code',
      'employee_number',
      'staff_id',
      'personnel_id',
      'payroll_id',
      'badge_id',
      'worker_id',
      'person_id',
      'serial_no',
      'pk_id',
      'id',
    ];
    const existingCandidates = candidates.filter(
      (c) =>
        existingColumns.length === 0 ||
        existingColumns.some((ec) => ec.toLowerCase() === c.toLowerCase()),
    );

    // Probe every candidate and keep the best (highest distinct/total ratio
    // with zero nulls).
    let best: {
      column: string;
      distinct: number;
      nonNull: number;
      confidence: number;
    } = { column: '', distinct: 0, nonNull: 0, confidence: 0 };

    for (const col of existingCandidates) {
      try {
        const rows = await sql.executeQuery<{ d: number | string; nn: number | string }>(
          schemaName,
          `SELECT COUNT(DISTINCT \`${col}\`) AS d,
                  SUM(CASE WHEN \`${col}\` IS NOT NULL AND \`${col}\` != '' THEN 1 ELSE 0 END) AS nn
             FROM \`${tableName}\``,
        );
        const distinct = Number(rows[0]?.d ?? 0) || 0;
        const nonNull = Number(rows[0]?.nn ?? 0) || 0;
        // Confidence = 1.0 iff every row has a distinct non-null value.
        const confidence = nonNull === total && total > 0 ? distinct / total : 0;
        this.logger.log(
          `[tenant-sync] candidate ${tableName}.${col} distinct=${distinct} nonNull=${nonNull}/${total} confidence=${confidence.toFixed(3)}`,
        );
        if (confidence > best.confidence) {
          best = { column: col, distinct, nonNull, confidence };
        }
        if (confidence === 1) break; // perfect match — stop probing
      } catch {
        /* column doesn't exist or typed incompatibly — skip */
      }
    }

    if (best.confidence >= 0.95 && best.column) {
      return {
        column: best.column,
        distinct: best.distinct,
        total,
        confidence: best.confidence,
        source: 'candidate',
      };
    }

    // ── Step 5: nothing passed the strict test ──────────────
    // Log WARN and return best-effort. Caller decides whether to proceed.
    this.logger.warn(
      `[tenant-sync] NO unique id column found for ${tableName}. Best candidate: ${best.column || 'none'} (confidence ${best.confidence.toFixed(3)}). ` +
        `Sync will FAIL unless a valid column is configured in IntegrationConnector.config.detectedEmployeeIdColumn.`,
    );
    return {
      column: best.column,
      distinct: best.distinct,
      total,
      confidence: best.confidence,
      source: 'fallback',
    };
  }

  /**
   * Resolve the employee-id column for a tenant's employee table.
   *
   * Reads IntegrationConnector.config.detectedEmployeeIdColumn first.
   * If missing (first sync), runs detection and persists the result.
   * If present, uses it without re-probing — delta syncs hit this path
   * every 120 seconds so re-detection would be wasteful.
   *
   * Caller is expected to pass the connectorId. If not available (legacy
   * code paths), falls back to pure detection.
   */
  private async resolveIdColumn(
    sql: CompportCloudSqlService,
    schemaName: string,
    tableName: string,
    tenantId: string,
    connectorId: string | null,
  ): Promise<{
    column: string;
    distinct: number;
    total: number;
    confidence: number;
    source: 'config' | 'pk' | 'candidate' | 'fallback';
  }> {
    // Try config first
    if (connectorId) {
      try {
        const connector = await this.db.forTenant(tenantId, (tx) =>
          tx.integrationConnector.findFirst({
            where: { id: connectorId, tenantId },
            select: { config: true },
          }),
        );
        const cfg = (connector?.config as Record<string, unknown> | null) ?? {};
        const tableCfg =
          (cfg['idColumns'] as Record<string, unknown> | undefined)?.[tableName] ??
          (tableName === 'employee_master' && typeof cfg['detectedEmployeeIdColumn'] === 'string'
            ? {
                column: cfg['detectedEmployeeIdColumn'],
                confidence: cfg['idColumnConfidence'] ?? 0,
                distinct: cfg['idColumnDistinct'] ?? 0,
                total: cfg['idColumnTotal'] ?? 0,
              }
            : undefined);
        if (tableCfg && typeof (tableCfg as { column?: unknown }).column === 'string') {
          const stored = tableCfg as {
            column: string;
            confidence?: number;
            distinct?: number;
            total?: number;
          };
          if (stored.column) {
            this.logger.log(
              `[tenant-sync] Using stored idColumn for ${tableName}: ${stored.column} (confidence=${stored.confidence ?? 'unknown'})`,
            );
            return {
              column: stored.column,
              distinct: Number(stored.distinct ?? 0),
              total: Number(stored.total ?? 0),
              confidence: Number(stored.confidence ?? 1),
              source: 'config',
            };
          }
        }
      } catch (err) {
        this.logger.warn(
          `[tenant-sync] Failed to read connector config: ${(err as Error).message?.substring(0, 120)}`,
        );
      }
    }

    // Detect and persist
    const detected = await this.detectEmployeeIdColumn(sql, schemaName, tableName);

    if (connectorId && detected.column && detected.confidence >= 0.95) {
      try {
        // Fetch current config first, merge the new id-column info, write back.
        const current = await this.db.forTenant(tenantId, (tx) =>
          tx.integrationConnector.findFirst({
            where: { id: connectorId, tenantId },
            select: { config: true },
          }),
        );
        const cfg = ((current?.config as Record<string, unknown> | null) ?? {}) as Record<
          string,
          unknown
        >;
        const existingByTable = (cfg['idColumns'] as Record<string, unknown> | undefined) ?? {};
        const nextByTable: Record<string, unknown> = {
          ...existingByTable,
          [tableName]: {
            column: detected.column,
            confidence: detected.confidence,
            distinct: detected.distinct,
            total: detected.total,
            source: detected.source,
            detectedAt: new Date().toISOString(),
          },
        };
        const nextCfg: Record<string, unknown> = {
          ...cfg,
          idColumns: nextByTable,
        };
        // For backward compatibility with legacy readers, also mirror
        // employee_master's detection at the top level.
        if (tableName === 'employee_master') {
          nextCfg['detectedEmployeeIdColumn'] = detected.column;
          nextCfg['idColumnConfidence'] = detected.confidence;
          nextCfg['idColumnDistinct'] = detected.distinct;
          nextCfg['idColumnTotal'] = detected.total;
        }
        await this.db.forTenant(tenantId, (tx) =>
          tx.integrationConnector.update({
            where: { id: connectorId },
            data: { config: nextCfg as never },
          }),
        );
        this.logger.log(
          `[tenant-sync] Persisted idColumn for ${tableName}: ${detected.column} (confidence=${detected.confidence.toFixed(3)}, source=${detected.source})`,
        );
      } catch (err) {
        this.logger.warn(
          `[tenant-sync] Failed to persist idColumn: ${(err as Error).message?.substring(0, 120)}`,
        );
      }
    }

    return detected;
  }

  /**
   * Pre-load all manage_* lookup tables from Cloud SQL into memory.
   * These are small tables (10–870 rows each) used to resolve numeric FK IDs
   * in the login_user table to human-readable names.
   */
  private async loadLookupMaps(
    schemaName: string,
    sqlOverride?: CompportCloudSqlService,
  ): Promise<LookupMaps> {
    const csql = sqlOverride ?? this.cloudSql;
    const loadTable = async (tableName: string): Promise<Map<number, string>> => {
      try {
        const rows = await csql.executeQuery<{ id: number; name: string }>(
          schemaName,
          `SELECT id, name FROM \`${tableName}\``,
          [],
        );
        const map = new Map<number, string>();
        for (const row of rows) {
          if (row.id != null && row.name != null) {
            map.set(Number(row.id), String(row.name));
          }
        }
        return map;
      } catch (err) {
        this.logger.warn(`Failed to load lookup table ${tableName}: ${(err as Error).message}`);
        return new Map();
      }
    };

    const [
      functions,
      levels,
      grades,
      designations,
      cities,
      subfunctions,
      employeeRoles,
      employeeTypes,
      costCenters,
      countries,
      businessLevel1,
      businessLevel2,
      businessLevel3,
      educations,
      roles,
    ] = await Promise.all([
      loadTable('manage_function'),
      loadTable('manage_level'),
      loadTable('manage_grade'),
      loadTable('manage_designation'),
      loadTable('manage_city'),
      loadTable('manage_subfunction'),
      loadTable('manage_employee_role'),
      loadTable('manage_employee_type'),
      loadTable('manage_cost_center'),
      loadTable('manage_country'),
      loadTable('manage_business_level_1'),
      loadTable('manage_business_level_2'),
      loadTable('manage_business_level_3'),
      loadTable('manage_education'),
      loadTable('manage_role'),
    ]);

    return {
      functions,
      levels,
      grades,
      designations,
      cities,
      subfunctions,
      employeeRoles,
      employeeTypes,
      costCenters,
      countries,
      businessLevel1,
      businessLevel2,
      businessLevel3,
      educations,
      roles,
    };
  }

  /**
   * Second pass: resolve manager_name (employee_code) → PG Employee.id.
   *
   * 1. Build employeeCode → PG id map from PostgreSQL
   * 2. Query Cloud SQL for employee_code → manager_name pairs
   * 3. Batch-update managerId for each employee
   */
  private async resolveManagerRelationships(
    tenantId: string,
    schemaName: string,
    tableName: string,
    sqlOverride?: CompportCloudSqlService,
  ): Promise<void> {
    const csql = sqlOverride ?? this.cloudSql;
    const start = Date.now();

    // Step 1: Build employeeCode → PG id map
    const employees = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.findMany({
        where: { tenantId },
        select: { id: true, employeeCode: true },
      }),
    );
    const codeToId = new Map<string, string>();
    for (const emp of employees) {
      codeToId.set(emp.employeeCode, emp.id);
    }

    // Step 2: Query Cloud SQL for employee_code → manager_name pairs
    let offset = 0;
    let hasMore = true;
    let resolved = 0;
    let unresolved = 0;
    let selfRef = 0;
    let noManager = 0;

    while (hasMore) {
      const rows = await csql.executeQuery<{
        employee_code: string;
        manager_name: string | null;
      }>(schemaName, `SELECT employee_code, manager_name FROM \`${tableName}\` LIMIT ? OFFSET ?`, [
        BATCH_SIZE,
        offset,
      ]);

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      // Step 3: Batch-update managerId
      for (const row of rows) {
        const empCode = String(row.employee_code);
        const mgrCode = row.manager_name ? String(row.manager_name).trim() : null;

        if (!mgrCode || mgrCode === '' || mgrCode === '0') {
          noManager++;
          continue;
        }

        // Skip self-referencing managers
        if (mgrCode === empCode) {
          selfRef++;
          continue;
        }

        const employeeId = codeToId.get(empCode);
        const managerId = codeToId.get(mgrCode);

        if (!employeeId) continue; // Employee not in PG (shouldn't happen)

        if (managerId) {
          try {
            await this.db.forTenant(tenantId, (tx) =>
              tx.employee.update({
                where: { id: employeeId },
                data: { managerId },
              }),
            );
            resolved++;
          } catch (err) {
            this.logger.warn(`Failed to set manager for ${empCode}: ${(err as Error).message}`);
          }
        } else {
          unresolved++;
        }
      }

      offset += rows.length;
      if (rows.length < BATCH_SIZE) hasMore = false;
    }

    const duration = Date.now() - start;
    this.logger.log(
      `Manager resolution: resolved=${resolved}, unresolved=${unresolved}, ` +
        `selfRef=${selfRef}, noManager=${noManager}, duration=${duration}ms`,
    );
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

  /**
   * Sync roles, pages, and role_permissions from Compport Cloud SQL into
   * CompportIQ's TenantRole, TenantPage, and TenantRolePermission tables.
   *
   * Also syncs login_user records: updates User.role with the actual Compport
   * role ID and links User ↔ Employee via employee_code.
   *
   * Assumes Cloud SQL connection is already established.
   */
  async syncRolesAndPermissions(
    tenantId: string,
    schemaName: string,
    cloudSqlOverride?: CompportCloudSqlService,
  ): Promise<RoleSyncResult> {
    const csql = cloudSqlOverride ?? this.cloudSql;
    const start = Date.now();
    const result: RoleSyncResult = {
      roles: { synced: 0, errors: 0 },
      pages: { synced: 0, errors: 0 },
      permissions: { synced: 0, errors: 0 },
      users: { synced: 0, linked: 0, errors: 0 },
      durationMs: 0,
    };

    // ── Step 1: Sync roles ─────────────────────────────────────
    try {
      const rows = await csql.executeQuery<{
        role_pk_id: number;
        id: string;
        name: string;
        module: string | null;
      }>(schemaName, 'SELECT role_pk_id, id, name, module FROM `roles`');

      for (const row of rows) {
        try {
          const compportRoleId = String(row.id).trim();
          await this.db.forTenant(tenantId, (tx) =>
            tx.tenantRole.upsert({
              where: { tenantId_compportRoleId: { tenantId, compportRoleId } },
              create: {
                tenantId,
                compportRoleId,
                name: String(row.name ?? '').trim(),
                module: row.module ? String(row.module).trim() : null,
                isActive: true,
                syncedAt: new Date(),
              },
              update: {
                name: String(row.name ?? '').trim(),
                module: row.module ? String(row.module).trim() : null,
                isActive: true,
                syncedAt: new Date(),
              },
            }),
          );
          result.roles.synced++;
        } catch (err) {
          result.roles.errors++;
          this.logger.warn(`Failed to sync role ${row.id}: ${(err as Error).message}`);
        }
      }
      this.logger.log(`Roles synced: ${result.roles.synced} ok, ${result.roles.errors} errors`);
    } catch (err) {
      this.logger.warn(`Failed to load roles table: ${(err as Error).message}`);
    }

    // ── Step 2: Sync pages ─────────────────────────────────────
    try {
      const rows = await csql.executeQuery<{
        id: number;
        name: string;
        uri_segment: string | null;
        type: string | null;
        status: string | null;
      }>(schemaName, 'SELECT id, name, uri_segment, type, status FROM `pages`');

      for (const row of rows) {
        try {
          const compportPageId = String(row.id);
          await this.db.forTenant(tenantId, (tx) =>
            tx.tenantPage.upsert({
              where: { tenantId_compportPageId: { tenantId, compportPageId } },
              create: {
                tenantId,
                compportPageId,
                name: String(row.name ?? '').trim(),
                uriSegment: row.uri_segment ? String(row.uri_segment) : null,
                pageType: row.type ? String(row.type) : null,
                status: row.status ? String(row.status) : null,
                syncedAt: new Date(),
              },
              update: {
                name: String(row.name ?? '').trim(),
                uriSegment: row.uri_segment ? String(row.uri_segment) : null,
                pageType: row.type ? String(row.type) : null,
                status: row.status ? String(row.status) : null,
                syncedAt: new Date(),
              },
            }),
          );
          result.pages.synced++;
        } catch (err) {
          result.pages.errors++;
          this.logger.warn(`Failed to sync page ${row.id}: ${(err as Error).message}`);
        }
      }
      this.logger.log(`Pages synced: ${result.pages.synced} ok, ${result.pages.errors} errors`);
    } catch (err) {
      this.logger.warn(`Failed to load pages table: ${(err as Error).message}`);
    }

    // ── Step 3: Sync role_permissions ───────────────────────────
    // Build lookup maps: compportRoleId → TenantRole.id, compportPageId → TenantPage.id
    const roleMap = new Map<string, string>();
    const pageMap = new Map<string, string>();

    await this.db.forTenant(tenantId, async (tx) => {
      const roles = await tx.tenantRole.findMany({
        where: { tenantId },
        select: { id: true, compportRoleId: true },
      });
      for (const r of roles) roleMap.set(r.compportRoleId, r.id);

      const pages = await tx.tenantPage.findMany({
        where: { tenantId },
        select: { id: true, compportPageId: true },
      });
      for (const p of pages) pageMap.set(p.compportPageId, p.id);
    });

    try {
      const rows = await csql.executeQuery<{
        role_id: string;
        page_id: number;
        view: number;
        insert: number;
        update: number;
        delete: number;
      }>(
        schemaName,
        'SELECT role_id, page_id, `view`, `insert`, `update`, `delete` FROM `role_permissions`',
      );

      for (const row of rows) {
        try {
          const compportRoleId = String(row.role_id).trim();
          const compportPageId = String(row.page_id);
          const roleId = roleMap.get(compportRoleId);
          const pageId = pageMap.get(compportPageId);

          if (!roleId || !pageId) {
            // Role or page not found — skip (may not have synced yet)
            continue;
          }

          await this.db.forTenant(tenantId, (tx) =>
            tx.tenantRolePermission.upsert({
              where: { tenantId_roleId_pageId: { tenantId, roleId, pageId } },
              create: {
                tenantId,
                roleId,
                pageId,
                canView: row.view === 1,
                canInsert: row.insert === 1,
                canUpdate: row.update === 1,
                canDelete: row.delete === 1,
                syncedAt: new Date(),
              },
              update: {
                canView: row.view === 1,
                canInsert: row.insert === 1,
                canUpdate: row.update === 1,
                canDelete: row.delete === 1,
                syncedAt: new Date(),
              },
            }),
          );
          result.permissions.synced++;
        } catch (err) {
          result.permissions.errors++;
          this.logger.warn(`Failed to sync permission: ${(err as Error).message}`);
        }
      }
      this.logger.log(
        `Permissions synced: ${result.permissions.synced} ok, ${result.permissions.errors} errors`,
      );
    } catch (err) {
      this.logger.warn(`Failed to load role_permissions table: ${(err as Error).message}`);
    }

    // ── Step 4: Sync login_user → User records (batched) ─────────
    try {
      const rows = await csql.executeQuery<{
        employee_code: string;
        role: string;
        email: string | null;
        name: string | null;
      }>(schemaName, 'SELECT employee_code, role, email, name FROM `login_user`');

      this.logger.log(`Loaded ${rows.length} login_user rows for batch sync`);

      // Deduplicate by email (some rows share emails causing unique constraint violations)
      const userMap = new Map<string, { email: string; name: string; role: string; employeeCode: string }>();
      for (const row of rows) {
        const employeeCode = String(row.employee_code || '').trim();
        const roleId = String(row.role || 'EMPLOYEE').trim();
        const email = (row.email ? String(row.email).trim() : '') || `${employeeCode}@compport.local`;
        const name = row.name ? String(row.name).trim() : employeeCode;
        if (!email) continue;
        userMap.set(email, { email, name, role: roleId, employeeCode });
      }

      const uniqueUsers = Array.from(userMap.values());
      this.logger.log(`Deduplicated to ${uniqueUsers.length} unique users by email`);

      // Batch upsert in chunks of 1000 inside single transactions
      const BATCH = 1000;
      for (let i = 0; i < uniqueUsers.length; i += BATCH) {
        const chunk = uniqueUsers.slice(i, i + BATCH);
        try {
          await this.db.forTenant(tenantId, async (tx) => {
            for (const u of chunk) {
              try {
                await tx.user.upsert({
                  where: { tenantId_email: { tenantId, email: u.email } },
                  create: { tenantId, email: u.email, name: u.name, role: u.role, passwordHash: '' },
                  update: { name: u.name, role: u.role },
                });
                result.users.synced++;
              } catch {
                result.users.errors++;
              }
            }
          });
        } catch (err) {
          result.users.errors += chunk.length;
          this.logger.warn(
            `User batch ${i}-${i + chunk.length} failed: ${(err as Error).message?.substring(0, 150)}`,
          );
        }
      }

      this.logger.log(
        `Users synced: ${result.users.synced} ok, ${result.users.errors} errors (skipping employee link for perf)`,
      );
    } catch (err) {
      this.logger.warn(`Failed to load login_user table: ${(err as Error).message}`);
    }

    result.durationMs = Date.now() - start;
    this.logger.log(`Role & permission sync complete in ${result.durationMs}ms`);
    return result;
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
      sslCa: process.env['MYSQL_CA_CERT'],
      sslCert: process.env['MYSQL_CLIENT_CERT'],
      sslKey: process.env['MYSQL_CLIENT_KEY'],
    });
  }
}
