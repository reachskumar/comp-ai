/**
 * One-off MySQL discovery script.
 * Connects to the Compport Cloud SQL instance and dumps:
 *   1. All databases (schemas)
 *   2. Tables inside `platform_admin_db`
 *   3. Columns of `manage_company`
 *   4. Sample rows from `manage_company`
 *   5. Row count
 *
 * Usage:  npx tsx scripts/discover-mysql.ts
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
// Load .env from repo root regardless of cwd
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
import * as mysql from 'mysql2/promise';
import * as fs from 'fs';

const ROOT = path.resolve(__dirname, '..');
const resolve = (p: string | undefined): Buffer | undefined => {
  if (!p) return undefined;
  // Resolve relative paths from repo root
  const abs = path.isAbsolute(p) ? p : path.resolve(ROOT, p);
  if (!fs.existsSync(abs)) {
    console.warn(`⚠️  SSL file not found: ${abs}`);
    return undefined;
  }
  return fs.readFileSync(abs);
};

async function main() {
  const host = process.env['DB_HOST']!;
  const user = process.env['DB_USER']!;
  const password = process.env['DB_PWD']!;
  const port = parseInt(process.env['DB_PORT'] ?? '3306', 10);

  console.log(`\n🔌 Connecting to MySQL at ${host}:${port} as ${user}…\n`);

  const ssl: mysql.SslOptions = {};
  const ca = resolve(process.env['MYSQL_CA_CERT']);
  const cert = resolve(process.env['MYSQL_CLIENT_CERT']);
  const key = resolve(process.env['MYSQL_CLIENT_KEY']);
  if (ca) ssl.ca = ca;
  if (cert) ssl.cert = cert;
  if (key) ssl.key = key;

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    ssl: Object.keys(ssl).length > 0 ? ssl : undefined,
    connectTimeout: 15_000,
  });

  // 1. List all databases
  console.log('═══════════════════════════════════════');
  console.log('1️⃣  ALL DATABASES (SHOW DATABASES)');
  console.log('═══════════════════════════════════════');
  const [dbs] = await conn.query('SHOW DATABASES');
  const dbList = (dbs as any[]).map((r) => Object.values(r)[0] as string);
  dbList.forEach((d) => console.log(`   • ${d}`));
  console.log(`   Total: ${dbList.length}\n`);

  // Check if platform_admin_db exists
  const ADMIN_DB = 'platform_admin_db';
  if (!dbList.includes(ADMIN_DB)) {
    console.error(`❌ '${ADMIN_DB}' not found! Available: ${dbList.join(', ')}`);
    await conn.end();
    return;
  }

  await conn.query(`USE \`${ADMIN_DB}\``);

  // 2. Tables in platform_admin_db
  console.log('═══════════════════════════════════════');
  console.log(`2️⃣  TABLES IN ${ADMIN_DB}`);
  console.log('═══════════════════════════════════════');
  const [tables] = await conn.query('SHOW TABLES');
  const tableList = (tables as any[]).map((r) => Object.values(r)[0] as string);
  tableList.forEach((t) => console.log(`   • ${t}`));
  console.log(`   Total: ${tableList.length}\n`);

  // 3. Describe manage_company
  if (!tableList.includes('manage_company')) {
    console.error(`❌ 'manage_company' table not found in ${ADMIN_DB}!`);
    console.log('Available tables:', tableList.join(', '));
    await conn.end();
    return;
  }

  console.log('═══════════════════════════════════════');
  console.log('3️⃣  COLUMNS OF manage_company (DESCRIBE)');
  console.log('═══════════════════════════════════════');
  const [cols] = await conn.query('DESCRIBE manage_company');
  console.table(cols);

  // 4. Row count
  const [countRows] = await conn.query('SELECT COUNT(*) AS total FROM manage_company');
  const total = (countRows as any[])[0].total;
  console.log(`\n   Total rows: ${total}`);

  // Count by status
  const [statusRows] = await conn.query(
    'SELECT status, COUNT(*) AS cnt FROM manage_company GROUP BY status ORDER BY status',
  );
  console.log('\n   By status:');
  (statusRows as any[]).forEach((r) => console.log(`     status=${r.status}: ${r.cnt} rows`));

  // 5. Sample rows (first 10)
  console.log('\n═══════════════════════════════════════');
  console.log('4️⃣  SAMPLE ROWS (LIMIT 10)');
  console.log('═══════════════════════════════════════');
  const [sampleRows] = await conn.query('SELECT * FROM manage_company LIMIT 10');
  console.table(sampleRows);

  // 6. Sample rows where status = 1 (active)
  console.log('\n═══════════════════════════════════════');
  console.log('5️⃣  ACTIVE COMPANIES (status=1, LIMIT 15)');
  console.log('═══════════════════════════════════════');
  const [activeRows] = await conn.query('SELECT * FROM manage_company WHERE status = 1 LIMIT 15');
  console.table(activeRows);

  await conn.end();
  console.log('\n✅ Discovery complete.');
}

main().catch((err) => {
  console.error('❌ Connection failed:', err.message);
  process.exit(1);
});
