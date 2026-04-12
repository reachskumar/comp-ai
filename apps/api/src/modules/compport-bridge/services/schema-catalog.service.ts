import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CompportCloudSqlService } from './compport-cloudsql.service';

/** Tables that should NEVER be mirrored regardless of catalog. */
const NEVER_MIRROR = new Set<string>([
  // System / framework tables
  'migrations',
  'cache',
  'sessions',
  'failed_jobs',
  'password_resets',
  // Anything we already model natively
  // (employee_master, login_user, roles, pages, role_permissions are kept
  //  in the mirror — they're useful for the agent in raw form even though
  //  the typed Prisma models also exist)
]);

/** Soft cap on row count for "mirrorable" classification. Tables larger
 *  than this are still catalogued but not mirrored by default — operator
 *  can flip isMirrorable manually if they want them. Keeps the initial
 *  mirror sync from churning on multi-million-row historical tables. */
const MIRROR_ROW_LIMIT = 1_000_000;

export interface CatalogColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimary: boolean;
  ordinalPosition: number;
}

export interface CatalogEntry {
  tableName: string;
  rowCount: number;
  primaryKeyColumns: string[];
  columns: CatalogColumn[];
  lastModifiedColumn: string | null;
  sampleRow: Record<string, unknown> | null;
  isMirrorable: boolean;
  reasonNotMirrorable: string | null;
}

/**
 * SchemaCatalogService — Phase 1 of the universal sync architecture.
 *
 * For a given tenant + Compport schema, walks every table in
 * INFORMATION_SCHEMA and builds a complete catalog: row counts, primary
 * keys, columns + types, sample rows, and the best candidate for a
 * "last modified" column (used by Phase 2 mirror sync for delta updates).
 *
 * The catalog is persisted into TenantSchemaCatalog so subsequent jobs
 * (mirror sync, agent introspection, onboarding flow) read from a stable
 * source instead of re-probing Compport every time.
 */
@Injectable()
export class SchemaCatalogService {
  private readonly logger = new Logger(SchemaCatalogService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Full discovery for a tenant. Returns the catalog entries it built and
   * persists them via upsert keyed on (tenantId, sourceSchema, tableName).
   * Idempotent — calling repeatedly refreshes counts and metadata in place.
   */
  async discoverAllTables(
    tenantId: string,
    connectorId: string,
    schemaName: string,
    sql: CompportCloudSqlService,
  ): Promise<CatalogEntry[]> {
    const start = Date.now();
    this.logger.log(`[catalog] Discovery started: tenant=${tenantId} schema=${schemaName}`);

    // ── Step 1: list every base table in the schema ─────────
    const tableRows = await sql.executeQuery<{ TABLE_NAME: string; TABLE_ROWS: number | string | null }>(
      schemaName,
      `SELECT TABLE_NAME, TABLE_ROWS
         FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ?
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
      [schemaName],
    );

    const tableNames = tableRows.map((r) => String(r.TABLE_NAME));
    this.logger.log(`[catalog] ${schemaName}: ${tableNames.length} base tables`);

    // ── Step 2: bulk-fetch column metadata for every table ──
    // One INFORMATION_SCHEMA query covers everything — much faster than
    // per-table DESCRIBE round-trips for 345-table schemas.
    const colRows = await sql.executeQuery<{
      TABLE_NAME: string;
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: string;
      ORDINAL_POSITION: number | string;
      COLUMN_KEY: string;
    }>(
      schemaName,
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, ORDINAL_POSITION, COLUMN_KEY
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [schemaName],
    );

    const columnsByTable = new Map<string, CatalogColumn[]>();
    for (const c of colRows) {
      const t = String(c.TABLE_NAME);
      const list = columnsByTable.get(t) ?? [];
      list.push({
        name: String(c.COLUMN_NAME),
        dataType: String(c.DATA_TYPE),
        nullable: String(c.IS_NULLABLE).toUpperCase() === 'YES',
        isPrimary: String(c.COLUMN_KEY) === 'PRI',
        ordinalPosition: Number(c.ORDINAL_POSITION) || 0,
      });
      columnsByTable.set(t, list);
    }

    // ── Step 3: bulk-fetch primary key columns ──────────────
    const pkRows = await sql.executeQuery<{ TABLE_NAME: string; COLUMN_NAME: string }>(
      schemaName,
      `SELECT TABLE_NAME, COLUMN_NAME
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ?
          AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [schemaName],
    );

    const pkByTable = new Map<string, string[]>();
    for (const p of pkRows) {
      const t = String(p.TABLE_NAME);
      const list = pkByTable.get(t) ?? [];
      list.push(String(p.COLUMN_NAME));
      pkByTable.set(t, list);
    }

    // ── Step 4: per-table loop — exact counts, sample row, last-modified ──
    const TS_COLS = ['updated_at', 'modified_at', 'modified_date', 'last_modified', 'updated_on'];
    const entries: CatalogEntry[] = [];

    for (const tableName of tableNames) {
      try {
        const cols = columnsByTable.get(tableName) ?? [];
        const pk = pkByTable.get(tableName) ?? [];

        // Last-modified candidate: pick the first matching column name
        const colNamesLower = cols.map((c) => c.name.toLowerCase());
        const lastModCol = TS_COLS.find((c) => colNamesLower.includes(c)) ?? null;

        // Exact row count (TABLE_ROWS in InnoDB is just an estimate)
        let rowCount = 0;
        try {
          const cnt = await sql.executeQuery<{ c: number | string }>(
            schemaName,
            `SELECT COUNT(*) AS c FROM \`${tableName}\``,
          );
          rowCount = Number(cnt[0]?.c ?? 0) || 0;
        } catch (err) {
          this.logger.warn(
            `[catalog] count failed for ${schemaName}.${tableName}: ${(err as Error).message?.substring(0, 120)}`,
          );
          rowCount = Number(tableRows.find((r) => String(r.TABLE_NAME) === tableName)?.TABLE_ROWS ?? 0) || 0;
        }

        // Sample row — limit 1 — useful for the agent to introspect shape
        let sampleRow: Record<string, unknown> | null = null;
        if (rowCount > 0) {
          try {
            const sample = await sql.executeQuery<Record<string, unknown>>(
              schemaName,
              `SELECT * FROM \`${tableName}\` LIMIT 1`,
            );
            sampleRow = sample[0] ?? null;
            // Coerce Date / Buffer / BigInt for JSON storage
            if (sampleRow) {
              for (const k of Object.keys(sampleRow)) {
                const v = sampleRow[k];
                if (v instanceof Date) sampleRow[k] = v.toISOString();
                else if (typeof v === 'bigint') sampleRow[k] = v.toString();
                else if (Buffer.isBuffer(v)) sampleRow[k] = `<buffer:${v.length}>`;
              }
            }
          } catch (err) {
            this.logger.warn(
              `[catalog] sample failed for ${schemaName}.${tableName}: ${(err as Error).message?.substring(0, 120)}`,
            );
          }
        }

        // Mirrorable classification
        let isMirrorable = true;
        let reasonNotMirrorable: string | null = null;
        if (NEVER_MIRROR.has(tableName)) {
          isMirrorable = false;
          reasonNotMirrorable = 'system table';
        } else if (rowCount > MIRROR_ROW_LIMIT) {
          isMirrorable = false;
          reasonNotMirrorable = `row count ${rowCount} > limit ${MIRROR_ROW_LIMIT}`;
        } else if (cols.length === 0) {
          isMirrorable = false;
          reasonNotMirrorable = 'no columns discovered';
        }

        entries.push({
          tableName,
          rowCount,
          primaryKeyColumns: pk,
          columns: cols,
          lastModifiedColumn: lastModCol,
          sampleRow,
          isMirrorable,
          reasonNotMirrorable,
        });
      } catch (err) {
        this.logger.error(
          `[catalog] entry failed for ${tableName}: ${(err as Error).message?.substring(0, 200)}`,
        );
      }
    }

    // ── Step 5: persist via upsert ───────────────────────────
    // We do this in chunks of 100 to keep individual transactions reasonable.
    const CHUNK = 100;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      try {
        await this.db.forTenant(
          tenantId,
          async (tx) => {
            for (const e of chunk) {
              await tx.tenantSchemaCatalog.upsert({
                where: {
                  tenantId_sourceSchema_tableName: {
                    tenantId,
                    sourceSchema: schemaName,
                    tableName: e.tableName,
                  },
                },
                create: {
                  tenantId,
                  connectorId,
                  sourceSchema: schemaName,
                  tableName: e.tableName,
                  rowCount: e.rowCount,
                  primaryKeyColumns: e.primaryKeyColumns,
                  columns: (e.columns ?? []) as never,
                  lastModifiedColumn: e.lastModifiedColumn,
                  sampleRow: (e.sampleRow ?? null) as never,
                  isMirrorable: e.isMirrorable,
                  mirrorTableName: this.sanitizeMirrorTableName(e.tableName),
                },
                update: {
                  connectorId,
                  rowCount: e.rowCount,
                  primaryKeyColumns: e.primaryKeyColumns,
                  columns: (e.columns ?? []) as never,
                  lastModifiedColumn: e.lastModifiedColumn,
                  sampleRow: (e.sampleRow ?? null) as never,
                  isMirrorable: e.isMirrorable,
                  mirrorTableName: this.sanitizeMirrorTableName(e.tableName),
                  lastDiscoveredAt: new Date(),
                },
              });
            }
          },
          { timeout: 60_000, maxWait: 10_000 },
        );
      } catch (err) {
        const fullMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `[catalog] persist chunk ${i}-${i + chunk.length} failed: ${fullMsg.substring(0, 500)}`,
        );
        // Try single-row recovery so one bad table doesn't block the rest
        for (const e of chunk) {
          try {
            await this.db.forTenant(tenantId, (tx) =>
              tx.tenantSchemaCatalog.upsert({
                where: {
                  tenantId_sourceSchema_tableName: {
                    tenantId,
                    sourceSchema: schemaName,
                    tableName: e.tableName,
                  },
                },
                create: {
                  tenantId,
                  connectorId,
                  sourceSchema: schemaName,
                  tableName: e.tableName,
                  rowCount: e.rowCount,
                  primaryKeyColumns: e.primaryKeyColumns,
                  columns: (e.columns ?? []) as never,
                  lastModifiedColumn: e.lastModifiedColumn,
                  sampleRow: (e.sampleRow ?? null) as never,
                  isMirrorable: e.isMirrorable,
                  mirrorTableName: this.sanitizeMirrorTableName(e.tableName),
                },
                update: {
                  connectorId,
                  rowCount: e.rowCount,
                  primaryKeyColumns: e.primaryKeyColumns,
                  columns: (e.columns ?? []) as never,
                  lastModifiedColumn: e.lastModifiedColumn,
                  sampleRow: (e.sampleRow ?? null) as never,
                  isMirrorable: e.isMirrorable,
                  mirrorTableName: this.sanitizeMirrorTableName(e.tableName),
                  lastDiscoveredAt: new Date(),
                },
              }),
            );
          } catch (rowErr) {
            this.logger.warn(
              `[catalog] single-row persist failed for ${e.tableName}: ${(rowErr as Error).message?.substring(0, 300)}`,
            );
          }
        }
      }
    }

    const durationMs = Date.now() - start;
    this.logger.log(
      `[catalog] Discovery complete: tenant=${tenantId} schema=${schemaName} ` +
        `tables=${entries.length} mirrorable=${entries.filter((e) => e.isMirrorable).length} ` +
        `duration=${durationMs}ms`,
    );

    return entries;
  }

  /**
   * Mirror table name = lowercased source name with anything that isn't
   * [a-z0-9_] replaced by underscore. Postgres identifiers are
   * case-folded by default and we want predictable names.
   */
  private sanitizeMirrorTableName(source: string): string {
    return source.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  /**
   * Read the catalog for a tenant — used by the mirror sync and agent tools.
   */
  async getCatalog(tenantId: string, sourceSchema?: string): Promise<CatalogEntry[]> {
    const rows = await this.db.forTenant(tenantId, (tx) =>
      tx.tenantSchemaCatalog.findMany({
        where: { tenantId, ...(sourceSchema ? { sourceSchema } : {}) },
        orderBy: { tableName: 'asc' },
      }),
    );
    return rows.map((r) => ({
      tableName: r.tableName,
      rowCount: r.rowCount,
      primaryKeyColumns: r.primaryKeyColumns,
      columns: (r.columns as unknown as CatalogColumn[]) ?? [],
      lastModifiedColumn: r.lastModifiedColumn,
      sampleRow: (r.sampleRow as Record<string, unknown> | null) ?? null,
      isMirrorable: r.isMirrorable,
      reasonNotMirrorable: null,
    }));
  }
}
