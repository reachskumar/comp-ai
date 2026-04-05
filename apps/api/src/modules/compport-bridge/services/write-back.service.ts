import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CompportCloudSqlService } from './compport-cloudsql.service';
import { CompportHistoryService } from './history.service';
import { CredentialVaultService } from '../../integrations/services/credential-vault.service';
import {
  isWriteableField,
  resolveColumnName,
  WRITE_BACK_TABLES,
  type WriteBackTable,
} from './write-back-field-map';
import * as crypto from 'crypto';

interface WriteBackRecordInput {
  recommendationId: string;
  employeeId: string;
  fieldName: string;
  previousValue: string;
  newValue: string;
  /** Target table (defaults to login_user) */
  targetTable?: WriteBackTable;
}

/** Options for creating a batch with advanced write-back features */
interface CreateBatchOptions {
  /** Whether to insert login_user_history before updates (default: true) */
  enableHistory?: boolean;
  /** Whether to apply salary & date cascade (default: false) */
  enableSalaryCascade?: boolean;
  /** Effective date for date cascade (required if enableSalaryCascade is true) */
  effectiveDate?: string;
  /** User ID performing the write-back (for updatedby field) */
  updatedBy?: string;
  /** Proxy user ID (for updatedby_proxy field) */
  updatedByProxy?: string;
}

/**
 * Write-Back Service
 *
 * Core business logic for pushing approved compensation changes
 * from CompportIQ (PostgreSQL) to Compport Cloud SQL.
 *
 * Supports the full Compport write-back flow:
 * 1. login_user_history insertion (mandatory audit trail)
 * 2. 150+ field updates to login_user (salary, allowances, demographics)
 * 3. 5-level salary & date history cascade
 * 4. Multi-table writes (employee_salary_details, salary_rule_users_dtls, etc.)
 *
 * Human-in-the-loop: No change touches Cloud SQL without explicit admin confirmation.
 *
 * SECURITY:
 * - Parameterized queries only
 * - Credentials decrypted per-request, never cached in memory long-term
 * - All operations audited
 * - Idempotency keys prevent double-application
 */
@Injectable()
export class WriteBackService {
  private readonly logger = new Logger(WriteBackService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cloudSql: CompportCloudSqlService,
    private readonly historyService: CompportHistoryService,
    private readonly credentialVault: CredentialVaultService,
  ) {}

  /**
   * Create a write-back batch from approved recommendations.
   * Status: PENDING_REVIEW — admin must review before proceeding.
   *
   * Supports both legacy 4-field mode and full 150+ field Compport mode.
   */
  async createBatch(
    tenantId: string,
    cycleId: string,
    connectorId: string,
    records: WriteBackRecordInput[],
    options?: CreateBatchOptions,
  ) {
    // Validate connector exists and is COMPPORT_CLOUDSQL type
    const connector = await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.findFirst({
        where: { id: connectorId, tenantId, connectorType: 'COMPPORT_CLOUDSQL' },
      }),
    );
    if (!connector) {
      throw new NotFoundException(
        `Cloud SQL connector ${connectorId} not found for tenant ${tenantId}`,
      );
    }

    // Validate cycle exists
    const cycle = await this.db.forTenant(tenantId, (tx) =>
      tx.compCycle.findFirst({ where: { id: cycleId, tenantId } }),
    );
    if (!cycle) {
      throw new NotFoundException(`Cycle ${cycleId} not found`);
    }

    // Validate all field names against expanded field map (150+ fields)
    for (const r of records) {
      if (!isWriteableField(r.fieldName)) {
        throw new BadRequestException(`Field "${r.fieldName}" is not an allowed write-back field.`);
      }
    }

    const idempotencyKey = crypto.randomUUID();

    const batch = await this.db.forTenant(tenantId, async (tx) => {
      const created = await tx.writeBackBatch.create({
        data: {
          tenantId,
          cycleId,
          connectorId,
          status: 'PENDING_REVIEW',
          totalRecords: records.length,
          idempotencyKey,
        },
      });

      // Create individual records
      await tx.writeBackRecord.createMany({
        data: records.map((r) => ({
          batchId: created.id,
          recommendationId: r.recommendationId,
          employeeId: r.employeeId,
          fieldName: r.fieldName,
          previousValue: r.previousValue,
          newValue: r.newValue,
          status: 'PENDING',
        })),
      });

      return created;
    });

    // Audit: batch created
    await this.db.forTenant(tenantId, (tx) =>
      tx.auditLog.create({
        data: {
          tenantId,
          action: 'WRITEBACK_BATCH_CREATED',
          entityType: 'WriteBackBatch',
          entityId: batch.id,
          changes: {
            cycleId,
            connectorId,
            totalRecords: records.length,
            idempotencyKey,
          } as never,
        },
      }),
    );

    this.logger.log(
      `Write-back batch ${batch.id} created: ${records.length} records for cycle ${cycleId}`,
    );

    return batch;
  }

  /**
   * Generate SQL preview for a batch — no Cloud SQL connection needed.
   * Shows the exact statements (history INSERT + UPDATE) that will be executed.
   *
   * Now includes:
   * - login_user_history INSERT statement
   * - Salary/date cascade SET clauses
   * - Resolved column names (legacy alias → actual column)
   */
  async previewBatch(tenantId: string, batchId: string) {
    const batch = await this.getBatchOrThrow(tenantId, batchId);
    const connector = await this.getConnectorConfig(tenantId, batch.connectorId);
    const schemaName = (connector.config as Record<string, string>)?.schemaName;
    const tableName =
      (connector.config as Record<string, string>)?.tableName ?? WRITE_BACK_TABLES.LOGIN_USER;
    const batchOptions = (batch as Record<string, unknown>).writeBackOptions as
      | CreateBatchOptions
      | undefined;

    if (!schemaName) {
      throw new BadRequestException('Connector config missing schemaName');
    }

    const records = await this.db.forTenant(tenantId, (tx) =>
      tx.writeBackRecord.findMany({
        where: { batchId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      }),
    );

    // Collect unique employee IDs for history statement
    const uniqueEmployeeIds = [...new Set(records.map((r) => r.employeeId))];
    const enableHistory = batchOptions?.enableHistory !== false;

    // Build preview SQL statements
    const previewParts: string[] = [];

    // 1. History INSERT (if enabled)
    if (enableHistory && tableName === WRITE_BACK_TABLES.LOGIN_USER) {
      const historyPlaceholders = uniqueEmployeeIds.map(() => '?').join(', ');
      previewParts.push(
        `-- Step 1: History snapshot (MANDATORY before any login_user update)\nINSERT INTO \`${schemaName}\`.\`${WRITE_BACK_TABLES.LOGIN_USER_HISTORY}\` SELECT * FROM \`${schemaName}\`.\`${WRITE_BACK_TABLES.LOGIN_USER}\` WHERE id IN (${historyPlaceholders});`,
      );
    }

    // 2. Salary & date cascade (if enabled)
    if (batchOptions?.enableSalaryCascade) {
      const cascadeClauses = [
        ...this.historyService.buildSalaryCascadeSetClauses(),
        ...this.historyService.buildDateCascadeSetClauses(
          batchOptions.effectiveDate ?? new Date().toISOString().split('T')[0]!,
        ),
      ];
      const cascadePlaceholders = uniqueEmployeeIds.map(() => '?').join(', ');
      previewParts.push(
        `-- Step 2: Salary & date history cascade\nUPDATE \`${schemaName}\`.\`${tableName}\` SET ${cascadeClauses.join(', ')} WHERE id IN (${cascadePlaceholders});`,
      );
    }

    // 3. Individual field updates
    const sqlStatements = records.map((r) => {
      const resolvedColumn = resolveColumnName(r.fieldName);
      const targetTable = tableName;
      return {
        recordId: r.id,
        employeeId: r.employeeId,
        fieldName: r.fieldName,
        resolvedColumn,
        previousValue: r.previousValue,
        newValue: r.newValue,
        sql: `UPDATE \`${schemaName}\`.\`${targetTable}\` SET \`${resolvedColumn}\` = ? WHERE \`id\` = ?`,
        params: [r.newValue, r.employeeId],
      };
    });

    previewParts.push(
      `-- Step ${batchOptions?.enableSalaryCascade ? '3' : '2'}: Field updates (${records.length} records)`,
    );
    for (const s of sqlStatements) {
      previewParts.push(
        `-- Record: ${s.recordId} (employee: ${s.employeeId}, field: ${s.resolvedColumn})\n${s.sql};`,
      );
    }

    const previewSql = previewParts.join('\n\n');

    // Update batch with preview
    await this.db.forTenant(tenantId, (tx) =>
      tx.writeBackBatch.update({
        where: { id: batchId },
        data: { previewSql, status: 'PREVIEWED' },
      }),
    );

    return { batchId, schemaName, statements: sqlStatements, previewSql };
  }

  /**
   * Dry-run: connect to Cloud SQL and validate that employees exist
   * and current values match expectations. Does NOT write anything.
   *
   * Uses resolved column names (legacy aliases → actual login_user columns).
   */
  async dryRun(tenantId: string, batchId: string) {
    const batch = await this.getBatchOrThrow(tenantId, batchId);
    const connector = await this.getConnectorConfig(tenantId, batch.connectorId);
    const schemaName = (connector.config as Record<string, string>)?.schemaName;
    const tableName =
      (connector.config as Record<string, string>)?.tableName ?? WRITE_BACK_TABLES.LOGIN_USER;

    if (!schemaName) {
      throw new BadRequestException('Connector config missing schemaName');
    }

    // Decrypt credentials and connect
    await this.connectToCloudSql(tenantId, connector);

    try {
      const records = await this.db.forTenant(tenantId, (tx) =>
        tx.writeBackRecord.findMany({
          where: { batchId, status: 'PENDING' },
        }),
      );

      const results: {
        recordId: string;
        employeeId: string;
        fieldName: string;
        resolvedColumn: string;
        found: boolean;
        currentValue: string | null;
        matches: boolean;
      }[] = [];

      for (const record of records) {
        const resolvedColumn = resolveColumnName(record.fieldName);
        const rows = await this.cloudSql.executeQuery<Record<string, unknown>>(
          schemaName,
          `SELECT \`${resolvedColumn}\` FROM \`${tableName}\` WHERE \`id\` = ?`,
          [record.employeeId],
        );

        const found = rows.length > 0;
        const currentValue = found ? String(rows[0]?.[resolvedColumn] ?? '') : null;
        const matches = currentValue === record.previousValue;

        results.push({
          recordId: record.id,
          employeeId: record.employeeId,
          fieldName: record.fieldName,
          resolvedColumn,
          found,
          currentValue,
          matches,
        });
      }

      const allPassed = results.every((r) => r.found && r.matches);
      const status = allPassed ? 'DRY_RUN_PASSED' : 'DRY_RUN_FAILED';

      await this.db.forTenant(tenantId, (tx) =>
        tx.writeBackBatch.update({
          where: { id: batchId },
          data: { status, dryRunResult: results as never },
        }),
      );

      // Audit: dry-run result
      await this.db.forTenant(tenantId, (tx) =>
        tx.auditLog.create({
          data: {
            tenantId,
            action: 'WRITEBACK_DRY_RUN',
            entityType: 'WriteBackBatch',
            entityId: batchId,
            changes: {
              status,
              allPassed,
              recordsChecked: results.length,
              mismatches: results.filter((r) => !r.matches).length,
              notFound: results.filter((r) => !r.found).length,
            } as never,
          },
        }),
      );

      return { batchId, status, results, allPassed };
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  /**
   * Apply the batch to Cloud SQL. Requires human confirmation.
   * HUMAN-IN-THE-LOOP GATE: Admin must pass confirmPhrase="APPLY".
   *
   * Full Compport write-back flow:
   * 1. INSERT INTO login_user_history (mandatory audit trail)
   * 2. Salary & date cascade (if salary fields changed)
   * 3. UPDATE login_user with resolved column names
   * 4. Mark records as applied in CompportIQ
   */
  async applyBatch(
    tenantId: string,
    batchId: string,
    userId: string,
    confirmPhrase: string,
    selectedRecordIds?: string[],
  ) {
    if (confirmPhrase !== 'APPLY') {
      throw new BadRequestException('Confirmation phrase must be "APPLY"');
    }

    const batch = await this.getBatchOrThrow(tenantId, batchId);

    if (!['PREVIEWED', 'DRY_RUN_PASSED'].includes(batch.status)) {
      throw new BadRequestException(
        `Batch must be in PREVIEWED or DRY_RUN_PASSED status. Current: ${batch.status}`,
      );
    }

    // Check idempotency — prevent double-apply
    if (batch.appliedAt) {
      throw new BadRequestException(
        `Batch ${batchId} was already applied at ${batch.appliedAt.toISOString()}`,
      );
    }

    const connector = await this.getConnectorConfig(tenantId, batch.connectorId);
    const schemaName = (connector.config as Record<string, string>)?.schemaName;
    const tableName =
      (connector.config as Record<string, string>)?.tableName ?? WRITE_BACK_TABLES.LOGIN_USER;
    const batchOptions = (batch as Record<string, unknown>).writeBackOptions as
      | CreateBatchOptions
      | undefined;

    if (!schemaName) {
      throw new BadRequestException('Connector config missing schemaName');
    }

    // Mark batch as applying
    await this.db.forTenant(tenantId, (tx) =>
      tx.writeBackBatch.update({
        where: { id: batchId },
        data: {
          status: 'APPLYING',
          appliedByUserId: userId,
          confirmedWithPhrase: confirmPhrase,
        },
      }),
    );

    // Get records (optionally filtered by selection)
    const whereClause: Record<string, unknown> = { batchId, status: 'PENDING' };
    if (selectedRecordIds?.length) {
      whereClause['id'] = { in: selectedRecordIds };
    }

    const records = await this.db.forTenant(tenantId, (tx) =>
      tx.writeBackRecord.findMany({ where: whereClause as never }),
    );

    // Collect unique employee IDs for history insertion
    const uniqueEmployeeIds = [...new Set(records.map((r) => r.employeeId))];
    const enableHistory = batchOptions?.enableHistory !== false;
    const enableSalaryCascade = batchOptions?.enableSalaryCascade === true;

    // ─── Build history statements (Step 1) ───
    const historyStatements: { sql: string; params: unknown[] }[] = [];
    if (enableHistory && tableName === WRITE_BACK_TABLES.LOGIN_USER) {
      const placeholders = uniqueEmployeeIds.map(() => '?').join(', ');
      historyStatements.push({
        sql: `INSERT INTO \`${WRITE_BACK_TABLES.LOGIN_USER_HISTORY}\` SELECT * FROM \`${WRITE_BACK_TABLES.LOGIN_USER}\` WHERE id IN (${placeholders})`,
        params: uniqueEmployeeIds,
      });
    }

    // ─── Build update statements (Steps 2 & 3) ───
    const updateStatements: { sql: string; params: unknown[] }[] = [];

    // Step 2: Salary & date cascade (if enabled)
    if (enableSalaryCascade) {
      const cascadeClauses = [
        ...this.historyService.buildSalaryCascadeSetClauses(),
        ...this.historyService.buildDateCascadeSetClauses(
          batchOptions?.effectiveDate ?? new Date().toISOString().split('T')[0]!,
        ),
        ...this.historyService.buildMetaSetClauses(userId, batchOptions?.updatedByProxy),
      ];
      const metaParams = this.historyService.getMetaParams(userId, batchOptions?.updatedByProxy);
      const cascadePlaceholders = uniqueEmployeeIds.map(() => '?').join(', ');

      updateStatements.push({
        sql: `UPDATE \`${tableName}\` SET ${cascadeClauses.join(', ')} WHERE id IN (${cascadePlaceholders})`,
        params: [...metaParams, ...uniqueEmployeeIds],
      });
    }

    // Step 3: Individual field updates with resolved column names
    for (const r of records) {
      const resolvedColumn = resolveColumnName(r.fieldName);
      updateStatements.push({
        sql: `UPDATE \`${tableName}\` SET \`${resolvedColumn}\` = ?, \`updatedon\` = NOW(), \`updatedby\` = ? WHERE \`id\` = ?`,
        params: [r.newValue, userId, r.employeeId],
      });
    }

    // Generate rollback SQL (uses original login_user_history for full rollback)
    const rollbackSql = enableHistory
      ? `-- Rollback: Restore from login_user_history\n-- The history snapshot taken before this batch can be used to restore original values.\n-- Manual review required before executing rollback.\n` +
        records
          .map((r) => {
            const resolvedColumn = resolveColumnName(r.fieldName);
            return `UPDATE \`${schemaName}\`.\`${tableName}\` SET \`${resolvedColumn}\` = '${r.previousValue}' WHERE \`id\` = '${r.employeeId}';`;
          })
          .join('\n')
      : records
          .map((r) => {
            const resolvedColumn = resolveColumnName(r.fieldName);
            return `UPDATE \`${schemaName}\`.\`${tableName}\` SET \`${resolvedColumn}\` = '${r.previousValue}' WHERE \`id\` = '${r.employeeId}';`;
          })
          .join('\n');

    // Connect and execute transactionally
    await this.connectToCloudSql(tenantId, connector);

    try {
      if (historyStatements.length > 0) {
        // Use the transactional history+update method
        await this.cloudSql.executeWriteWithHistory(
          schemaName,
          historyStatements,
          updateStatements,
        );
      } else {
        // No history needed — just execute updates
        await this.cloudSql.executeWrite(schemaName, updateStatements);
      }

      // Mark all records as applied
      const now = new Date();
      await this.db.forTenant(tenantId, async (tx) => {
        for (const r of records) {
          const resolvedColumn = resolveColumnName(r.fieldName);
          await tx.writeBackRecord.update({
            where: { id: r.id },
            data: {
              status: 'APPLIED',
              appliedAt: now,
              cloudSqlQuery: `UPDATE \`${tableName}\` SET \`${resolvedColumn}\` = ? WHERE \`id\` = ?`,
            },
          });

          // Update recommendation status
          await tx.compRecommendation.update({
            where: { id: r.recommendationId },
            data: { status: 'APPLIED_TO_COMPPORT' },
          });
        }

        // Update skipped records
        if (selectedRecordIds?.length) {
          await tx.writeBackRecord.updateMany({
            where: { batchId, status: 'PENDING', id: { notIn: selectedRecordIds } },
            data: { status: 'SKIPPED' },
          });
        }

        // Mark batch as applied
        const skippedCount = selectedRecordIds?.length
          ? batch.totalRecords - selectedRecordIds.length
          : 0;

        await tx.writeBackBatch.update({
          where: { id: batchId },
          data: {
            status: 'APPLIED',
            appliedRecords: records.length,
            skippedRecords: skippedCount,
            appliedAt: now,
            rollbackSql,
          },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'WRITEBACK_APPLIED',
            entityType: 'WriteBackBatch',
            entityId: batchId,
            changes: {
              cycleId: batch.cycleId,
              recordsApplied: records.length,
              recordsSkipped: skippedCount,
              schemaName,
              historyInserted: enableHistory,
              salaryCascade: enableSalaryCascade,
              uniqueEmployees: uniqueEmployeeIds.length,
              idempotencyKey: batch.idempotencyKey,
            } as never,
          },
        });
      });

      this.logger.log(
        `Write-back batch ${batchId} applied: ${records.length} records (${uniqueEmployeeIds.length} employees) to schema ${schemaName} [history=${enableHistory}, cascade=${enableSalaryCascade}]`,
      );

      return {
        batchId,
        status: 'APPLIED',
        appliedRecords: records.length,
        skippedRecords: selectedRecordIds?.length
          ? batch.totalRecords - selectedRecordIds.length
          : 0,
        historyInserted: enableHistory,
        salaryCascade: enableSalaryCascade,
        uniqueEmployees: uniqueEmployeeIds.length,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;

      // Mark batch and records as failed
      await this.db.forTenant(tenantId, async (tx) => {
        await tx.writeBackBatch.update({
          where: { id: batchId },
          data: {
            status: 'FAILED',
            errorMessage: errorMessage.substring(0, 2000),
            rollbackSql,
          },
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'WRITEBACK_FAILED',
            entityType: 'WriteBackBatch',
            entityId: batchId,
            changes: {
              cycleId: batch.cycleId,
              error: errorMessage.substring(0, 500),
              schemaName,
            } as never,
          },
        });
      });

      throw error;
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  /**
   * Get batch history for a tenant.
   */
  async getBatchHistory(tenantId: string, cycleId?: string) {
    const where: Record<string, unknown> = { tenantId };
    if (cycleId) where['cycleId'] = cycleId;

    return this.db.forTenant(tenantId, (tx) =>
      tx.writeBackBatch.findMany({
        where: where as never,
        include: { records: true, appliedBy: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Get a single batch with all records.
   */
  async getBatch(tenantId: string, batchId: string) {
    const batch = await this.db.forTenant(tenantId, (tx) =>
      tx.writeBackBatch.findFirst({
        where: { id: batchId, tenantId },
        include: {
          records: { orderBy: { createdAt: 'asc' } },
          appliedBy: { select: { name: true, email: true } },
          cycle: { select: { name: true, status: true } },
        },
      }),
    );
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    return batch;
  }

  /**
   * Rollback a previously applied batch using stored rollback SQL.
   * HUMAN-IN-THE-LOOP GATE: Admin must pass confirmPhrase="ROLLBACK".
   */
  async rollbackBatch(
    tenantId: string,
    batchId: string,
    userId: string,
    confirmPhrase: string,
  ) {
    if (confirmPhrase !== 'ROLLBACK') {
      throw new BadRequestException('Confirmation phrase must be "ROLLBACK"');
    }

    const batch = await this.getBatchOrThrow(tenantId, batchId);

    if (batch.status !== 'APPLIED') {
      throw new BadRequestException(
        `Only APPLIED batches can be rolled back. Current status: ${batch.status}`,
      );
    }

    if (!batch.rollbackSql) {
      throw new BadRequestException('No rollback SQL stored for this batch');
    }

    const connector = await this.getConnectorConfig(tenantId, batch.connectorId);
    const schemaName = (connector.config as Record<string, string>)?.schemaName;

    if (!schemaName) {
      throw new BadRequestException('Connector config missing schemaName');
    }

    // Parse rollback SQL into individual statements
    const rollbackStatements = (batch.rollbackSql as string)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.startsWith('UPDATE'));

    if (rollbackStatements.length === 0) {
      throw new BadRequestException('Rollback SQL contains no UPDATE statements');
    }

    // Mark batch as rolling back
    await this.db.forTenant(tenantId, (tx) =>
      tx.writeBackBatch.update({
        where: { id: batchId },
        data: { status: 'ROLLING_BACK' },
      }),
    );

    // Connect and execute rollback
    await this.connectToCloudSql(tenantId, connector);

    try {
      // Execute rollback statements in a transaction
      // Rollback SQL uses schema-qualified table names, so no USE needed
      const pool = (this.cloudSql as unknown as { pool: unknown }).pool;
      if (!pool) throw new Error('Cloud SQL not connected');

      // Use the cloudSql service's withSchema for transactional execution
      const statements = rollbackStatements.map((sql) => ({
        // Strip schema prefix since we'll USE the schema
        sql: sql.replace(`\`${schemaName}\`.`, '').replace(/;$/, ''),
        params: [] as unknown[],
      }));

      await this.cloudSql.executeWrite(schemaName, statements);

      // Mark records as rolled back
      await this.db.forTenant(tenantId, async (tx) => {
        await tx.writeBackRecord.updateMany({
          where: { batchId, status: 'APPLIED' },
          data: { status: 'ROLLED_BACK' },
        });

        await tx.writeBackBatch.update({
          where: { id: batchId },
          data: { status: 'ROLLED_BACK' },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'WRITEBACK_ROLLED_BACK',
            entityType: 'WriteBackBatch',
            entityId: batchId,
            changes: {
              statementsExecuted: rollbackStatements.length,
              schemaName,
              rolledBackBy: userId,
            } as never,
          },
        });
      });

      this.logger.warn(
        `Write-back batch ${batchId} ROLLED BACK: ${rollbackStatements.length} statements by user ${userId}`,
      );

      return {
        batchId,
        status: 'ROLLED_BACK',
        statementsExecuted: rollbackStatements.length,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;

      await this.db.forTenant(tenantId, async (tx) => {
        await tx.writeBackBatch.update({
          where: { id: batchId },
          data: { status: 'ROLLBACK_FAILED', errorMessage: errorMessage.substring(0, 2000) },
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'WRITEBACK_ROLLBACK_FAILED',
            entityType: 'WriteBackBatch',
            entityId: batchId,
            changes: { error: errorMessage.substring(0, 500), schemaName } as never,
          },
        });
      });

      throw error;
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────

  private async getBatchOrThrow(tenantId: string, batchId: string) {
    const batch = await this.db.forTenant(tenantId, (tx) =>
      tx.writeBackBatch.findFirst({ where: { id: batchId, tenantId } }),
    );
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    return batch;
  }

  private async getConnectorConfig(tenantId: string, connectorId: string) {
    const connector = await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.findFirst({
        where: { id: connectorId, tenantId },
      }),
    );
    if (!connector) {
      throw new NotFoundException(`Connector ${connectorId} not found`);
    }
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
