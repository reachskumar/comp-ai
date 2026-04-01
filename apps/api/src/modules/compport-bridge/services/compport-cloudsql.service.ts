import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import * as fs from 'fs';

export interface CloudSqlConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  /** Path to CA certificate file */
  sslCa?: string;
  /** Path to client certificate file */
  sslCert?: string;
  /** Path to client key file */
  sslKey?: string;
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

    // Build SSL options from file paths (if provided)
    // Cloud Run secret volumes may be directories containing version files,
    // so we resolve paths: if it's a directory, read the first file inside it.
    const readSecretFile = (p: string): Buffer | undefined => {
      if (!fs.existsSync(p)) return undefined;
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(p).filter((f) => !f.startsWith('.'));
        if (files.length > 0) {
          this.logger.log(`SSL: resolved directory ${p} -> ${files[0]}`);
          return fs.readFileSync(`${p}/${files[0]}`);
        }
        this.logger.warn(`SSL: directory ${p} is empty`);
        return undefined;
      }
      return fs.readFileSync(p);
    };

    let ssl: mysql.SslOptions | undefined;
    if (config.sslCa || config.sslCert || config.sslKey) {
      ssl = {};
      if (config.sslCa) ssl.ca = readSecretFile(config.sslCa);
      if (config.sslCert) ssl.cert = readSecretFile(config.sslCert);
      if (config.sslKey) ssl.key = readSecretFile(config.sslKey);
      this.logger.log('SSL enabled for Cloud SQL connection');
    }

    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl,
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
      // Use query() instead of execute() to avoid MySQL prepared-statement
      // bugs with wide tables (e.g. "Incorrect arguments to mysqld_stmt_execute").
      const [rows] = await conn.query({ sql, values: params });
      return rows as T[];
    });
  }

  /**
   * Execute multiple write statements (INSERT/UPDATE/DELETE) within a single
   * Cloud SQL transaction. All-or-nothing: if any statement fails, the entire
   * batch rolls back.
   *
   * SECURITY: Only parameterized queries accepted. Never interpolates user data.
   *
   * @param options.allowZeroAffected - If true, don't throw on 0 affected rows
   *   (needed for INSERT INTO ... SELECT which returns ResultSetHeader differently)
   * @returns Number of affected rows per statement
   */
  async executeWrite(
    schemaName: string,
    statements: WriteStatement[],
    options?: { allowZeroAffected?: boolean },
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

        if (r.affectedRows === 0 && !options?.allowZeroAffected) {
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
   * Execute a transactional write that includes history insertion + updates.
   * This is the core pattern for Compport write-back:
   *   1. INSERT INTO login_user_history SELECT * FROM login_user WHERE ...
   *   2. UPDATE login_user SET ... (with salary cascade)
   *   3. Optional additional table updates
   *
   * All operations happen in a single transaction.
   */
  async executeWriteWithHistory(
    schemaName: string,
    historyStatements: WriteStatement[],
    updateStatements: WriteStatement[],
  ): Promise<{ historyRows: number[]; updateRows: number[] }> {
    const pool = this.ensurePool();
    const conn = await pool.getConnection();
    const historyRows: number[] = [];
    const updateRows: number[] = [];

    try {
      await conn.query({ sql: 'USE ??', values: [schemaName] });
      await conn.beginTransaction();

      // Step 1: Insert history FIRST (mandatory)
      for (const stmt of historyStatements) {
        const [result] = await conn.execute({ sql: stmt.sql, values: stmt.params });
        const r = result as mysql.ResultSetHeader;
        historyRows.push(r.affectedRows);
      }

      this.logger.log(
        `History insertion: ${historyRows.reduce((a, b) => a + b, 0)} rows in ${schemaName}`,
      );

      // Step 2: Execute updates
      for (const stmt of updateStatements) {
        const [result] = await conn.execute({ sql: stmt.sql, values: stmt.params });
        const r = result as mysql.ResultSetHeader;
        updateRows.push(r.affectedRows);
      }

      await conn.commit();
      this.logger.log(
        `Cloud SQL write-with-history: ${historyStatements.length} history + ${updateStatements.length} updates committed in ${schemaName}`,
      );
      return { historyRows, updateRows };
    } catch (error) {
      await conn.rollback();
      this.logger.error(
        `Cloud SQL write-with-history rolled back in schema ${schemaName}: ${(error as Error).message}`,
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
