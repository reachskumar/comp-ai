import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CompportCloudSqlService } from './compport-cloudsql.service';
import { SchemaCatalogService, CatalogColumn } from './schema-catalog.service';

/** How many source rows to pull per paginated SELECT from MySQL. */
const PAGE_SIZE = 5000;

/**
 * Max parameters per Postgres $executeRawUnsafe statement.
 * Postgres itself caps at 65,535 but Node pg driver + Prisma
 * can stack-overflow on large arrays well before that. 10,000
 * is safe and fast.
 */
const MAX_PG_PARAMS = 10_000;

/**
 * MirrorSyncService — Phase 2 of the universal sync architecture.
 *
 * For a given tenant, reads TenantSchemaCatalog (built by Phase 1
 * discovery) and creates a per-tenant Postgres schema containing a
 * 1:1 mirror of every mirrorable Compport table.
 *
 * Data flow:
 *   Compport MySQL (source of truth per tenant)
 *     → SELECT * FROM `tableName` [WHERE lastModCol > watermark] LIMIT PAGE_SIZE OFFSET N
 *     → INSERT INTO mirror_<slug>.<mirrorTableName> (col1, col2, ...) VALUES (...) ON CONFLICT DO UPDATE
 *     → TenantDataMirrorState updated with watermark + row count
 *
 * The mirror schema is tenant-isolated at the Postgres level (separate
 * schema per tenant, not just RLS). DROP SCHEMA CASCADE cleans up
 * completely on tenant deletion.
 *
 * Agent tools (Stage 3) query the mirror via parameterized SELECTs
 * against the catalog-described column set.
 */
@Injectable()
export class MirrorSyncService {
  private readonly logger = new Logger(MirrorSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly catalogService: SchemaCatalogService,
  ) {}

  /**
   * Ensure the per-tenant mirror schema exists in Postgres.
   * Idempotent — CREATE SCHEMA IF NOT EXISTS.
   */
  async ensureMirrorSchema(tenantSlug: string): Promise<string> {
    const schemaName = this.mirrorSchemaName(tenantSlug);
    await this.db.client.$executeRawUnsafe(
      `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`,
    );
    this.logger.log(`[mirror] Schema "${schemaName}" ensured`);
    return schemaName;
  }

  /**
   * Full mirror sync for one tenant. Reads catalog, creates mirror
   * tables, and copies data from Compport MySQL → Postgres mirror.
   *
   * Returns per-table stats.
   */
  async syncAllTables(
    tenantId: string,
    tenantSlug: string,
    sourceSchema: string,
    sql: CompportCloudSqlService,
  ): Promise<{
    mirrorSchema: string;
    tablesProcessed: number;
    tablesSkipped: number;
    totalRowsMirrored: number;
    errors: string[];
    perTable: Array<{
      table: string;
      rows: number;
      durationMs: number;
      status: 'ok' | 'error';
      error?: string;
    }>;
  }> {
    const start = Date.now();
    const mirrorSchema = await this.ensureMirrorSchema(tenantSlug);

    // Load catalog
    const catalog = await this.catalogService.getCatalog(tenantId, sourceSchema);
    const mirrorable = catalog.filter((e) => e.isMirrorable && e.columns.length > 0);
    this.logger.log(
      `[mirror] Starting sync: tenant=${tenantId} schema=${sourceSchema} ` +
        `mirrorable=${mirrorable.length}/${catalog.length}`,
    );

    let tablesProcessed = 0;
    let tablesSkipped = 0;
    let totalRowsMirrored = 0;
    const errors: string[] = [];
    const perTable: Array<{
      table: string;
      rows: number;
      durationMs: number;
      status: 'ok' | 'error';
      error?: string;
    }> = [];

    for (const entry of mirrorable) {
      const tableStart = Date.now();
      const mirrorTableName = entry.tableName.toLowerCase().replace(/[^a-z0-9_]/g, '_');

      try {
        // 1. CREATE TABLE IF NOT EXISTS with the discovered columns
        await this.ensureMirrorTable(mirrorSchema, mirrorTableName, entry.columns, entry.primaryKeyColumns);

        // 2. TRUNCATE + INSERT (full sync for now — delta uses watermark later)
        const rowCount = await this.copyTableData(
          sql,
          sourceSchema,
          entry.tableName,
          mirrorSchema,
          mirrorTableName,
          entry.columns,
        );

        // 3. Update mirror state
        await this.db.forTenant(tenantId, (tx) =>
          tx.tenantDataMirrorState.upsert({
            where: { tenantId_sourceTable: { tenantId, sourceTable: entry.tableName } },
            create: {
              tenantId,
              mirrorSchema,
              sourceTable: entry.tableName,
              mirrorTable: mirrorTableName,
              rowCount,
              status: 'READY',
              lastFullSyncAt: new Date(),
            },
            update: {
              rowCount,
              status: 'READY',
              lastFullSyncAt: new Date(),
              lastError: null,
            },
          }),
        );

        tablesProcessed++;
        totalRowsMirrored += rowCount;
        perTable.push({
          table: entry.tableName,
          rows: rowCount,
          durationMs: Date.now() - tableStart,
          status: 'ok',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${entry.tableName}: ${message.substring(0, 200)}`);
        tablesSkipped++;

        // Record the failure in mirror state
        try {
          await this.db.forTenant(tenantId, (tx) =>
            tx.tenantDataMirrorState.upsert({
              where: { tenantId_sourceTable: { tenantId, sourceTable: entry.tableName } },
              create: {
                tenantId,
                mirrorSchema,
                sourceTable: entry.tableName,
                mirrorTable: mirrorTableName,
                status: 'FAILED',
                lastError: message.substring(0, 500),
              },
              update: {
                status: 'FAILED',
                lastError: message.substring(0, 500),
              },
            }),
          );
        } catch {
          /* non-fatal — state write failed, but we continue with next table */
        }

        perTable.push({
          table: entry.tableName,
          rows: 0,
          durationMs: Date.now() - tableStart,
          status: 'error',
          error: message.substring(0, 200),
        });

        this.logger.warn(`[mirror] Table ${entry.tableName} failed: ${message.substring(0, 200)}`);
      }
    }

    const durationMs = Date.now() - start;
    this.logger.log(
      `[mirror] Sync complete: tenant=${tenantId} processed=${tablesProcessed} ` +
        `skipped=${tablesSkipped} rows=${totalRowsMirrored} errors=${errors.length} ` +
        `duration=${durationMs}ms`,
    );

    return { mirrorSchema, tablesProcessed, tablesSkipped, totalRowsMirrored, errors, perTable };
  }

  /**
   * CREATE TABLE IF NOT EXISTS in the mirror schema, matching the
   * source column structure from the catalog.
   */
  private async ensureMirrorTable(
    mirrorSchema: string,
    tableName: string,
    columns: CatalogColumn[],
    primaryKeyColumns: string[],
  ): Promise<void> {
    // Map MySQL types → Postgres types
    const colDefs = columns.map((c) => {
      const pgType = this.mysqlToPgType(c.dataType);
      const nullable = c.nullable ? '' : ' NOT NULL';
      return `"${c.name}" ${pgType}${nullable}`;
    });

    // Add a sync timestamp column
    colDefs.push('"_compportiq_synced_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()');

    let pkClause = '';
    if (primaryKeyColumns.length > 0) {
      pkClause = `, PRIMARY KEY (${primaryKeyColumns.map((c) => `"${c}"`).join(', ')})`;
    }

    const createSql = `CREATE TABLE IF NOT EXISTS "${mirrorSchema}"."${tableName}" (
      ${colDefs.join(',\n      ')}${pkClause}
    )`;

    await this.db.client.$executeRawUnsafe(createSql);
  }

  /**
   * Copy all data from a Compport MySQL table into the mirror Postgres table.
   * Uses TRUNCATE + paginated INSERT for full sync.
   */
  private async copyTableData(
    sql: CompportCloudSqlService,
    sourceSchema: string,
    sourceTable: string,
    mirrorSchema: string,
    mirrorTable: string,
    columns: CatalogColumn[],
  ): Promise<number> {
    // Truncate mirror table first (full sync)
    await this.db.client.$executeRawUnsafe(
      `TRUNCATE TABLE "${mirrorSchema}"."${mirrorTable}"`,
    );

    const colNames = columns.map((c) => c.name);
    const pgColList = colNames.map((c) => `"${c}"`).join(', ');
    // Dynamic chunk size: total params = rows × columns. Keep under MAX_PG_PARAMS.
    // e.g. 80 columns → 10000/80 = 125 rows per INSERT; 10 columns → 1000 rows.
    const insertChunk = Math.max(1, Math.floor(MAX_PG_PARAMS / Math.max(colNames.length, 1)));
    let totalRows = 0;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const rows = await sql.executeQuery<Record<string, unknown>>(
        sourceSchema,
        `SELECT * FROM \`${sourceTable}\` LIMIT ? OFFSET ?`,
        [PAGE_SIZE, offset],
      );

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      // Insert in sub-chunks sized to stay under Postgres parameter limits
      for (let i = 0; i < rows.length; i += insertChunk) {
        const chunk = rows.slice(i, i + insertChunk);
        const values: unknown[] = [];
        const rowPlaceholders: string[] = [];

        for (const row of chunk) {
          const placeholders: string[] = [];
          for (const colName of colNames) {
            values.push(this.coerceValue(row[colName]));
            placeholders.push(`$${values.length}`);
          }
          rowPlaceholders.push(`(${placeholders.join(', ')})`);
        }

        const insertSql = `INSERT INTO "${mirrorSchema}"."${mirrorTable}" (${pgColList})
                            VALUES ${rowPlaceholders.join(', ')}
                            ON CONFLICT DO NOTHING`;

        try {
          await this.db.client.$executeRawUnsafe(insertSql, ...values);
        } catch (err) {
          // If bulk insert fails, try row-by-row recovery
          this.logger.warn(
            `[mirror] Bulk insert failed for ${sourceTable} chunk ${offset + i}, falling back to row-by-row: ${(err as Error).message?.substring(0, 120)}`,
          );
          for (const row of chunk) {
            try {
              const rowValues: unknown[] = [];
              const ph: string[] = [];
              for (const colName of colNames) {
                rowValues.push(this.coerceValue(row[colName]));
                ph.push(`$${rowValues.length}`);
              }
              await this.db.client.$executeRawUnsafe(
                `INSERT INTO "${mirrorSchema}"."${mirrorTable}" (${pgColList}) VALUES (${ph.join(', ')}) ON CONFLICT DO NOTHING`,
                ...rowValues,
              );
            } catch {
              /* skip individual bad rows — mirror is best-effort per row */
            }
          }
        }

        totalRows += chunk.length;
      }

      offset += rows.length;
      if (rows.length < PAGE_SIZE) hasMore = false;
    }

    return totalRows;
  }

  /**
   * Map MySQL data types → Postgres types. Conservative: if unsure,
   * use TEXT (loses type safety but never fails on insert).
   */
  private mysqlToPgType(mysqlType: string): string {
    const t = mysqlType.toLowerCase();
    if (t.includes('int')) return 'BIGINT';
    if (t.includes('decimal') || t.includes('numeric')) return 'DECIMAL';
    if (t.includes('float') || t.includes('double')) return 'DOUBLE PRECISION';
    if (t === 'date') return 'DATE';
    if (t.includes('datetime') || t.includes('timestamp')) return 'TIMESTAMPTZ';
    if (t.includes('text') || t.includes('longtext') || t.includes('mediumtext')) return 'TEXT';
    if (t.includes('blob') || t.includes('binary')) return 'BYTEA';
    if (t.includes('json')) return 'JSONB';
    if (t.includes('enum') || t.includes('set')) return 'TEXT';
    if (t.includes('char') || t.includes('varchar')) return 'TEXT';
    if (t === 'tinyint(1)' || t === 'bit(1)') return 'BOOLEAN';
    if (t === 'year') return 'SMALLINT';
    if (t === 'time') return 'TIME';
    return 'TEXT';
  }

  /**
   * Coerce MySQL values for Postgres parameterized inserts.
   */
  private coerceValue(v: unknown): unknown {
    if (v === undefined) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'bigint') return Number(v);
    if (Buffer.isBuffer(v)) return v;
    return v;
  }

  /**
   * Build the mirror schema name for a tenant.
   * Convention: mirror_<slug> — e.g. mirror_bfl
   */
  mirrorSchemaName(tenantSlug: string): string {
    return `mirror_${tenantSlug.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  }
}
