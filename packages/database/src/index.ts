/**
 * @compensation/database
 * Database client and Prisma schema for the compensation platform.
 */

import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

export { PrismaClient } from './generated/prisma/client.js';
export * from './generated/prisma/client.js';

export interface PoolConfig {
  /** Minimum number of connections in the pool (default: 2) */
  min?: number;
  /** Maximum number of connections in the pool (default: 20) */
  max?: number;
  /** Milliseconds a connection can sit idle before being closed (default: 30000) */
  idleTimeoutMillis?: number;
  /** Milliseconds to wait for a connection before timing out (default: 5000) */
  connectionTimeoutMillis?: number;
  /** Enable SSL for the connection (default: false) */
  ssl?: boolean;
}

/**
 * Create a PrismaClient instance configured with the PostgreSQL driver adapter.
 * Prisma 7's `prisma-client` generator requires a driver adapter.
 *
 * Supports configurable connection pool options and SSL via environment
 * variables or explicit PoolConfig.
 */
export function createPrismaClient(url?: string, poolConfig?: PoolConfig): PrismaClient {
  const min = poolConfig?.min ?? (parseInt(process.env['DB_POOL_MIN'] ?? '', 10) || 2);
  const max = poolConfig?.max ?? (parseInt(process.env['DB_POOL_MAX'] ?? '', 10) || 20);
  const idleTimeoutMillis = poolConfig?.idleTimeoutMillis ?? (parseInt(process.env['DB_IDLE_TIMEOUT'] ?? '', 10) || 30000);
  const connectionTimeoutMillis = poolConfig?.connectionTimeoutMillis ?? (parseInt(process.env['DB_CONNECT_TIMEOUT'] ?? '', 10) || 5000);
  const sslEnabled = poolConfig?.ssl ?? process.env['DB_SSL'] === 'true';

  const poolOptions: pg.PoolConfig = {
    connectionString: url ?? process.env['DATABASE_URL'],
    min,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
  };

  if (sslEnabled) {
    poolOptions.ssl = { rejectUnauthorized: false };
  }

  const pool = new pg.Pool(poolOptions);
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;

