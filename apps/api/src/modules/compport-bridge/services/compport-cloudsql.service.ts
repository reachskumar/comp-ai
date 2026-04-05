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

  // Per-connector pool cache for multi-tenant scaling (250+ tenants)
  private readonly poolCache = new Map<string, { pool: mysql.Pool; lastUsed: number; healthy: boolean }>();
  private readonly MAX_CACHED_POOLS = 50;
  private readonly POOL_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  async onModuleDestroy(): Promise<void> {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    await this.disconnect();
    await this.closeAllCachedPools();
  }

  private lastConnectConfig: CloudSqlConnectionConfig | null = null;

  /**
   * Create a persistent connection pool to Cloud SQL.
   * Includes keepalive pings and auto-reconnect on failure.
   */
  async connect(config: CloudSqlConnectionConfig): Promise<void> {
    if (this.pool) {
      this.logger.warn('Cloud SQL pool already exists, closing old pool');
      await this.disconnect();
    }

    this.lastConnectConfig = config;

    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 10,
      connectTimeout: 15_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 5_000,
      idleTimeout: 0, // Never timeout idle connections
    });

    // Test the connection
    const conn = await this.pool.getConnection();
    conn.release();
    this.logger.log(`Connected to Cloud SQL at ${config.host}:${config.port}`);

    // Start keepalive ping every 30 seconds to prevent connection drops
    this.startKeepalive();
  }

  private startKeepalive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);

    this.keepAliveTimer = setInterval(async () => {
      // Ping primary pool
      if (this.pool) {
        try {
          const conn = await this.pool.getConnection();
          await conn.ping();
          conn.release();
        } catch {
          this.logger.warn('Primary Cloud SQL keepalive failed, attempting reconnect...');
          await this.reconnectPrimary();
        }
      }

      // Ping cached pools and mark health
      for (const [id, entry] of this.poolCache) {
        try {
          const conn = await entry.pool.getConnection();
          await conn.ping();
          conn.release();
          entry.healthy = true;
        } catch {
          entry.healthy = false;
          this.logger.warn(`Cached pool ${id} keepalive failed`);
        }
      }

      // Evict unhealthy idle pools
      await this.evictIdlePools();
    }, 30_000);
  }

  private async reconnectPrimary(): Promise<void> {
    if (!this.lastConnectConfig) return;
    try {
      if (this.pool) await this.pool.end().catch(() => {});
      this.pool = mysql.createPool({
        ...this.lastConnectConfig,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 10,
        connectTimeout: 15_000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 5_000,
        idleTimeout: 0,
      });
      const conn = await this.pool.getConnection();
      conn.release();
      this.logger.log('Cloud SQL primary pool reconnected');
    } catch (err) {
      this.logger.error(`Cloud SQL reconnect failed: ${(err as Error).message}`);
      this.pool = null;
    }
  }

  /**
   * Get or create a cached connection pool for a specific connector.
   * Pools are reused across requests and evicted after idle timeout.
   * This prevents pool exhaustion when 250+ tenants sync concurrently.
   */
  async getPoolForConnector(
    connectorId: string,
    config: CloudSqlConnectionConfig,
  ): Promise<mysql.Pool> {
    const cached = this.poolCache.get(connectorId);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.pool;
    }

    // Evict idle pools if we're at capacity
    if (this.poolCache.size >= this.MAX_CACHED_POOLS) {
      await this.evictIdlePools();
    }

    // If still at capacity after eviction, evict the oldest
    if (this.poolCache.size >= this.MAX_CACHED_POOLS) {
      const oldest = [...this.poolCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) {
        await oldest[1].pool.end().catch(() => {});
        this.poolCache.delete(oldest[0]);
      }
    }

    const pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 2,
      queueLimit: 3,
      connectTimeout: 10_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
    });

    // Test the connection
    const conn = await pool.getConnection();
    conn.release();

    this.poolCache.set(connectorId, { pool, lastUsed: Date.now(), healthy: true });
    this.logger.log(
      `Created cached pool for connector ${connectorId} (${this.poolCache.size}/${this.MAX_CACHED_POOLS} active)`,
    );

    return pool;
  }

  /**
   * Get connection status for all pools — used by platform admin dashboard.
   */
  getPoolStatus(): {
    primaryConnected: boolean;
    cachedPools: number;
    maxPools: number;
    pools: Array<{ connectorId: string; healthy: boolean; lastUsed: number }>;
  } {
    return {
      primaryConnected: this.pool !== null,
      cachedPools: this.poolCache.size,
      maxPools: this.MAX_CACHED_POOLS,
      pools: [...this.poolCache.entries()].map(([id, entry]) => ({
        connectorId: id,
        healthy: entry.healthy,
        lastUsed: entry.lastUsed,
      })),
    };
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.logger.log('Cloud SQL connection pool closed');
    }
  }

  private async evictIdlePools(): Promise<void> {
    const now = Date.now();
    for (const [id, entry] of this.poolCache) {
      if (now - entry.lastUsed > this.POOL_IDLE_TIMEOUT_MS) {
        await entry.pool.end().catch(() => {});
        this.poolCache.delete(id);
      }
    }
  }

  private async closeAllCachedPools(): Promise<void> {
    for (const [id, entry] of this.poolCache) {
      await entry.pool.end().catch(() => {});
      this.poolCache.delete(id);
    }
    this.logger.log('All cached Cloud SQL pools closed');
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
