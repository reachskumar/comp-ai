import { Injectable, Logger } from '@nestjs/common';
import { CompportCloudSqlService } from './compport-cloudsql.service';

// ─── Types ───────────────────────────────────────────────

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  defaultValue: string | null;
  extra: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

export interface SchemaInfo {
  name: string;
  tables: TableInfo[];
}

/** System databases to exclude from discovery */
const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

/**
 * Schema Discovery Service
 *
 * Connects to Compport Cloud SQL and discovers tenant schemas,
 * tables, and columns. Used for:
 * - Auto-discovering tenant database structures
 * - Feeding the AI field-mapping agent with source schemas
 * - Validating connector configuration
 *
 * SECURITY: Read-only operations. Never modifies Cloud SQL data.
 */
@Injectable()
export class SchemaDiscoveryService {
  private readonly logger = new Logger(SchemaDiscoveryService.name);

  constructor(private readonly cloudSql: CompportCloudSqlService) {}

  /**
   * List all non-system databases (schemas) in Cloud SQL.
   * Each database typically represents one Compport tenant.
   */
  async discoverSchemas(): Promise<string[]> {
    this.logger.log('Discovering Cloud SQL schemas');

    // SHOW DATABASES doesn't need a schema context — use a raw query
    // We use executeQuery with any valid schema; fall back to listing via pool
    const rows = await this.cloudSql.executeQuery<{ Database: string }>(
      'information_schema',
      'SELECT SCHEMA_NAME AS `Database` FROM SCHEMATA ORDER BY SCHEMA_NAME',
    );

    const schemas = rows.map((row) => row.Database).filter((name) => !SYSTEM_DATABASES.has(name));

    this.logger.log(`Discovered ${schemas.length} tenant schemas`);
    return schemas;
  }

  /**
   * List all tables in a specific schema.
   */
  async discoverTables(schemaName: string): Promise<string[]> {
    this.logger.log(`Discovering tables in schema: ${schemaName}`);
    return this.cloudSql.showTables(schemaName);
  }

  /**
   * Describe columns for a specific table.
   */
  async discoverColumns(schemaName: string, tableName: string): Promise<ColumnInfo[]> {
    this.logger.log(`Discovering columns: ${schemaName}.${tableName}`);

    const rows = await this.cloudSql.describeTable(schemaName, tableName);

    return rows.map((row) => ({
      name: String(row['Field'] ?? ''),
      type: String(row['Type'] ?? ''),
      nullable: row['Null'] === 'YES',
      key: String(row['Key'] ?? ''),
      defaultValue: row['Default'] != null ? String(row['Default']) : null,
      extra: String(row['Extra'] ?? ''),
    }));
  }

  /**
   * Full discovery: all tables + columns for a schema.
   */
  async discoverTenantSchema(schemaName: string): Promise<SchemaInfo> {
    this.logger.log(`Full schema discovery for: ${schemaName}`);

    const tableNames = await this.discoverTables(schemaName);
    const tables: TableInfo[] = [];

    for (const tableName of tableNames) {
      const columns = await this.discoverColumns(schemaName, tableName);
      tables.push({ name: tableName, columns });
    }

    this.logger.log(`Schema ${schemaName}: ${tables.length} tables discovered`);
    return { name: schemaName, tables };
  }
}
