import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as mysql from 'mysql2/promise';

export interface CloudSqlConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
}

export interface WriteStatement {
  sql: string;
  params: unknown[];
}

/**
 * Cloud SQL Connection Service.
 *
 * Connects to Compport's Google Cloud SQL (MySQL engine) via private IP.
 * Supports per-tenant schema switching and transactional writes.
 *
 * SECURITY:
 * - Private IP connection (same GCP VPC, no internet)
 * - Never logs credentials or full SQL with data values
 * - Parameterized queries only (prevents SQL injection)
 * - Connection pool limited (background work, not request-path)
 */
@Injectable()
export class CompportCloudSqlService implements OnModuleDestroy {
  private readonly logger = new Logger(CompportCloudSqlService.name);
  private pool: mysql.Pool | null = null;

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  /**
   * Create a connection pool to Cloud SQL.
   * Call this once during connector setup, not per-request.
   */
  async connect(config: CloudSqlConnectionConfig): Promise<void> {
    if (this.pool) {
      this.logger.warn('Cloud SQL pool already exists, closing old pool');
      await this.disconnect();
    }

    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 10,
      connectTimeout: 10_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
    });

    // Test the connection
    const conn = await this.pool.getConnection();
    conn.release();
    this.logger.log(`Connected to Cloud SQL at ${config.host}:${config.port}`);
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.logger.log('Cloud SQL connection pool closed');
    }
  }

  private ensurePool(): mysql.Pool {
    if (!this.pool) {
      throw new Error('Cloud SQL not connected. Call connect() first.');
    }
    return this.pool;
  }

  /**
   * Run a callback within a specific tenant schema context.
   */
  async withSchema<T>(
    schemaName: string,
    callback: (conn: mysql.PoolConnection) => Promise<T>,
  ): Promise<T> {
    const pool = this.ensurePool();
    const conn = await pool.getConnection();
    try {
      await conn.query({ sql: 'USE ??', values: [schemaName] });
      return await callback(conn);
    } finally {
      conn.release();
    }
  }

  /**
   * Discover tables in a tenant schema.
   */
  async showTables(schemaName: string): Promise<string[]> {
    return this.withSchema(schemaName, async (conn) => {
      const [rows] = await conn.query({ sql: 'SHOW TABLES' });
      return (rows as Record<string, string>[])
        .map((row) => Object.values(row)[0] ?? '')
        .filter(Boolean);
    });
  }

  /**
   * Describe a table's columns.
   */
  async describeTable(schemaName: string, tableName: string): Promise<Record<string, unknown>[]> {
    return this.withSchema(schemaName, async (conn) => {
      const [rows] = await conn.query({ sql: 'DESCRIBE ??', values: [tableName] });
      return rows as Record<string, unknown>[];
    });
  }

  /**
   * Execute a parameterized read query within a schema.
   */
  async executeQuery<T = Record<string, unknown>>(
    schemaName: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return this.withSchema(schemaName, async (conn) => {
      const [rows] = await conn.execute({ sql, values: params });
      return rows as T[];
    });
  }

  /**
   * Execute multiple UPDATE statements within a single Cloud SQL transaction.
   * All-or-nothing: if any statement fails, the entire batch rolls back.
   *
   * SECURITY: Only parameterized queries accepted. Never interpolates user data.
   *
   * @returns Number of affected rows per statement
   */
  async executeWrite(
    schemaName: string,
    statements: WriteStatement[],
  ): Promise<{ affectedRows: number[] }> {
    const pool = this.ensurePool();
    const conn = await pool.getConnection();
    const affectedRows: number[] = [];

    try {
      await conn.query({ sql: 'USE ??', values: [schemaName] });
      await conn.beginTransaction();

      for (const stmt of statements) {
        const [result] = await conn.execute({ sql: stmt.sql, values: stmt.params });
        const r = result as mysql.ResultSetHeader;
        affectedRows.push(r.affectedRows);

        if (r.affectedRows === 0) {
          throw new Error(`Write-back failed: 0 rows affected for query. Expected at least 1.`);
        }
      }

      await conn.commit();
      this.logger.log(
        `Cloud SQL write-back: ${statements.length} statements committed in schema ${schemaName}`,
      );
      return { affectedRows };
    } catch (error) {
      await conn.rollback();
      this.logger.error(
        `Cloud SQL write-back rolled back in schema ${schemaName}: ${(error as Error).message}`,
      );
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Check if the Cloud SQL connection is healthy.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const pool = this.ensurePool();
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a connection is established.
   */
  get isConnected(): boolean {
    return this.pool !== null;
  }
}
