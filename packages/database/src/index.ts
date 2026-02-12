/**
 * @compensation/database
 * Database client and Prisma schema for the compensation platform.
 */

import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

export { PrismaClient } from './generated/prisma/client.js';
export * from './generated/prisma/client.js';

/**
 * Create a PrismaClient instance configured with the PostgreSQL driver adapter.
 * Prisma 7's `prisma-client` generator requires a driver adapter.
 */
export function createPrismaClient(url?: string): PrismaClient {
  const pool = new pg.Pool({ connectionString: url ?? process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;

