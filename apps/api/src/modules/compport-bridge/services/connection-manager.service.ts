import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import * as fs from 'fs';
import { DatabaseService } from '../../../database';
import { CredentialVaultService } from '../../integrations/services/credential-vault.service';
import type { CloudSqlConnectionConfig } from './compport-cloudsql.service';

export interface TenantConnectionStatus {
  tenantId: string;
  connected: boolean;
  lastHealthCheck: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  connectedSince: Date | null;
  schemaName: string | null;
}

interface TenantPool {
  pool: mysql.Pool;
  config: CloudSqlConnectionConfig;
  tenantId: string;
  schemaName: string;
  connectedSince: Date;
  lastHealthCheck: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
}

/**
 * Connection Manager Service
 *
 * Maintains persistent per-tenant MySQL connection pools to Compport Cloud SQL.
 * Features:
 * - Per-tenant connection pools (not shared)
 * - Auto-reconnect with exponential backoff
 * - Periodic health checks
 * - Connection state tracking for monitoring
 */
@Injectable()
export class ConnectionManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectionManagerService.name);
  private readonly pools = new Map<string, TenantPool>();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  private static readonly HEALTH_CHECK_INTERVAL_MS = 30_000;
  private static readonly MAX_CONSECUTIVE_FAILURES = 5;
  private static readonly RECONNECT_BASE_DELAY_MS = 2_000;
  private static readonly POOL_SIZE = 3;

  constructor(
    private readonly db: DatabaseService,
    private readonly credentialVault: CredentialVaultService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.stopHealthChecks();
    await this.disconnectAll();
  }

  startHealthChecks(): void {
    if (this.healthCheckInterval) return;
    this.healthCheckInterval = setInterval(
      () => void this.runHealthChecks(),
      ConnectionManagerService.HEALTH_CHECK_INTERVAL_MS,
    );
    this.logger.log('Connection health checks started (every 30s)');
  }

  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async getPool(tenantId: string): Promise<mysql.Pool> {
    const existing = this.pools.get(tenantId);
    if (existing) {
      try {
        const conn = await existing.pool.getConnection();
        await conn.ping();
        conn.release();
        return existing.pool;
      } catch {
        this.logger.warn(`Pool for tenant ${tenantId} unhealthy, reconnecting...`);
        await this.disconnect(tenantId);
      }
    }
    return this.connect(tenantId);
  }

  async connect(tenantId: string): Promise<mysql.Pool> {
    const connector = await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.findFirst({
        where: { tenantId, connectorType: 'COMPPORT_CLOUDSQL', status: 'ACTIVE' },
      }),
    );
    if (!connector) {
      throw new Error(`No active COMPPORT_CLOUDSQL connector for tenant ${tenantId}`);
    }
    if (!connector.encryptedCredentials || !connector.credentialIv || !connector.credentialTag) {
      throw new Error(`Connector for tenant ${tenantId} has no stored credentials`);
    }

    const creds = this.credentialVault.decrypt(
      tenantId,
      connector.encryptedCredentials,
      connector.credentialIv,
      connector.credentialTag,
    );

    const config: CloudSqlConnectionConfig = {
      host: creds['host'] as string,
      port: (creds['port'] as number) ?? 3306,
      user: creds['user'] as string,
      password: creds['password'] as string,
      database: creds['database'] as string | undefined,
      sslCa: process.env['MYSQL_CA_CERT'],
      sslCert: process.env['MYSQL_CLIENT_CERT'],
      sslKey: process.env['MYSQL_CLIENT_KEY'],
    };

    const schemaName = (connector.config as Record<string, string>)?.schemaName ?? '';
    const pool = await this.createPool(config);

    this.pools.set(tenantId, {
      pool,
      config,
      tenantId,
      schemaName,
      connectedSince: new Date(),
      lastHealthCheck: null,
      lastError: null,
      consecutiveFailures: 0,
    });

    this.logger.log(`Persistent pool created for tenant ${tenantId} (schema: ${schemaName})`);
    return pool;
  }

  async disconnect(tenantId: string): Promise<void> {
    const entry = this.pools.get(tenantId);
    if (entry) {
      try {
        await entry.pool.end();
      } catch {
        /* ignore close errors */
      }
      this.pools.delete(tenantId);
      this.logger.log(`Pool closed for tenant ${tenantId}`);
    }
  }

  async disconnectAll(): Promise<void> {
    const tenants = Array.from(this.pools.keys());
    await Promise.allSettled(tenants.map((t) => this.disconnect(t)));
    this.logger.log(`All ${tenants.length} tenant pools closed`);
  }

  async executeQuery<T = Record<string, unknown>>(
    tenantId: string,
    schemaName: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const pool = await this.getPool(tenantId);
    const conn = await pool.getConnection();
    try {
      await conn.query({ sql: 'USE ??', values: [schemaName] });
      const [rows] = await conn.query({ sql, values: params });
      return rows as T[];
    } finally {
      conn.release();
    }
  }

  getSchemaName(tenantId: string): string | null {
    return this.pools.get(tenantId)?.schemaName ?? null;
  }

  getAllStatus(): TenantConnectionStatus[] {
    return Array.from(this.pools.values()).map((p) => ({
      tenantId: p.tenantId,
      connected: true,
      lastHealthCheck: p.lastHealthCheck,
      lastError: p.lastError,
      consecutiveFailures: p.consecutiveFailures,
      connectedSince: p.connectedSince,
      schemaName: p.schemaName,
    }));
  }

  getStatus(tenantId: string): TenantConnectionStatus {
    const p = this.pools.get(tenantId);
    if (!p) {
      return {
        tenantId,
        connected: false,
        lastHealthCheck: null,
        lastError: null,
        consecutiveFailures: 0,
        connectedSince: null,
        schemaName: null,
      };
    }
    return {
      tenantId: p.tenantId,
      connected: true,
      lastHealthCheck: p.lastHealthCheck,
      lastError: p.lastError,
      consecutiveFailures: p.consecutiveFailures,
      connectedSince: p.connectedSince,
      schemaName: p.schemaName,
    };
  }

  isConnected(tenantId: string): boolean {
    return this.pools.has(tenantId);
  }

  get activeConnections(): number {
    return this.pools.size;
  }

  // ─── Private ──────────────────────────────────────────────

  private async createPool(config: CloudSqlConnectionConfig): Promise<mysql.Pool> {
    const readSecretFile = (p: string): Buffer | undefined => {
      if (!fs.existsSync(p)) return undefined;
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        const files = fs.readdirSync(p).filter((f) => !f.startsWith('.'));
        return files.length > 0 ? fs.readFileSync(`${p}/${files[0]}`) : undefined;
      }
      return fs.readFileSync(p);
    };

    let ssl: mysql.SslOptions | undefined;
    if (config.sslCa || config.sslCert || config.sslKey) {
      ssl = {};
      if (config.sslCa) ssl.ca = readSecretFile(config.sslCa);
      if (config.sslCert) ssl.cert = readSecretFile(config.sslCert);
      if (config.sslKey) ssl.key = readSecretFile(config.sslKey);
    }

    const pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl,
      waitForConnections: true,
      connectionLimit: ConnectionManagerService.POOL_SIZE,
      queueLimit: 10,
      connectTimeout: 10_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
    });

    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    return pool;
  }

  private async runHealthChecks(): Promise<void> {
    for (const [tenantId, entry] of this.pools) {
      try {
        const conn = await entry.pool.getConnection();
        await conn.ping();
        conn.release();
        entry.lastHealthCheck = new Date();
        entry.consecutiveFailures = 0;
        entry.lastError = null;
      } catch (err) {
        entry.consecutiveFailures++;
        entry.lastError = (err as Error).message;
        entry.lastHealthCheck = new Date();
        this.logger.warn(
          `Health check failed for tenant ${tenantId} (${entry.consecutiveFailures}/${ConnectionManagerService.MAX_CONSECUTIVE_FAILURES}): ${entry.lastError}`,
        );
        if (entry.consecutiveFailures >= ConnectionManagerService.MAX_CONSECUTIVE_FAILURES) {
          this.logger.error(`Tenant ${tenantId} exceeded max failures, reconnecting...`);
          await this.reconnect(tenantId);
        }
      }
    }
  }

  private async reconnect(tenantId: string): Promise<void> {
    const entry = this.pools.get(tenantId);
    const failures = entry?.consecutiveFailures ?? 0;
    const delay = Math.min(
      ConnectionManagerService.RECONNECT_BASE_DELAY_MS * Math.pow(2, failures),
      60_000,
    );
    this.logger.log(`Reconnecting tenant ${tenantId} after ${delay}ms...`);
    try {
      await this.disconnect(tenantId);
      await new Promise((resolve) => setTimeout(resolve, delay));
      await this.connect(tenantId);
      this.logger.log(`Reconnected tenant ${tenantId} successfully`);
    } catch (err) {
      this.logger.error(`Reconnect failed for tenant ${tenantId}: ${(err as Error).message}`);
    }
  }
}
