/**
 * Production seed script — creates the initial PLATFORM_ADMIN user.
 *
 * This is idempotent: re-running won't duplicate the tenant or user.
 *
 * Environment variables:
 *   DATABASE_URL  — required
 *   ADMIN_EMAIL   — defaults to admin@compportiq.ai
 *   ADMIN_PASSWORD — defaults to ChangeMe123!@#
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcryptjs';

const ADMIN_EMAIL = process.env['ADMIN_EMAIL'] || 'admin@compportiq.ai';
const ADMIN_PASSWORD = process.env['ADMIN_PASSWORD'] || 'ChangeMe123!@#';

if (!process.env['DATABASE_URL']) {
  console.error('❌ DATABASE_URL is required');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Production seed — creating initial PLATFORM_ADMIN...');

  // 1. Create the platform tenant (not subject to RLS)
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'platform' },
    update: {},
    create: {
      name: 'CompportIQ Platform',
      slug: 'platform',
      plan: 'enterprise',
      settings: { features: ['platform-admin'] },
    },
  });
  console.log(`  ✅ Tenant: ${tenant.name} (${tenant.id})`);

  // 2. Set RLS context for tenant-scoped tables
  await pool.query(`SET app.current_tenant_id = '${tenant.id}'`);
  console.log(`  🔒 RLS context set for tenant: ${tenant.id}`);

  // 3. Create PLATFORM_ADMIN user
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: ADMIN_EMAIL } },
    update: { passwordHash },
    create: {
      tenantId: tenant.id,
      email: ADMIN_EMAIL,
      name: 'Platform Admin',
      role: 'PLATFORM_ADMIN',
      passwordHash,
    },
  });
  console.log(`  ✅ Admin: ${admin.name} <${admin.email}> (${admin.id})`);
  console.log('');
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  📧 Email:    ${ADMIN_EMAIL}`);
  console.log(`  🔑 Password: (set via ADMIN_PASSWORD env var)`);
  console.log('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('🎉 Production seed complete! You can now log in.');
}

main()
  .catch((e) => {
    console.error('❌ Production seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
