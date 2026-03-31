// pnpm hoists to .pnpm — find mysql2 dynamically
const { execSync } = require('child_process');
const found = execSync('find /app -path "*/mysql2/promise.js" -maxdepth 8 2>/dev/null | head -1')
  .toString()
  .trim();
if (!found) {
  console.error('mysql2 not found in image');
  process.exit(1);
}
console.log('Using mysql2 from:', found);
const mysql = require(found);
const fs = require('fs');
const readFile = (envVar) => {
  const p = process.env[envVar];
  if (!p) return undefined;
  try {
    if (fs.statSync(p).isDirectory()) {
      const files = fs.readdirSync(p).filter((f) => !f.startsWith('.'));
      return files.length ? fs.readFileSync(p + '/' + files[0]) : undefined;
    }
    return fs.readFileSync(p);
  } catch (e) {
    console.log('SSL file issue:', envVar, e.message);
    return undefined;
  }
};
(async () => {
  const ssl = {};
  const ca = readFile('MYSQL_CA_CERT');
  if (ca) ssl.ca = ca;
  const cert = readFile('MYSQL_CLIENT_CERT');
  if (cert) ssl.cert = cert;
  const key = readFile('MYSQL_CLIENT_KEY');
  if (key) ssl.key = key;
  console.log('Connecting to', process.env.DB_HOST, 'as', process.env.DB_USER);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PWD,
    ssl: Object.keys(ssl).length > 0 ? ssl : undefined,
    connectTimeout: 15000,
  });
  console.log('=== DATABASES ===');
  const [dbs] = await conn.query('SHOW DATABASES');
  dbs.forEach((r) => console.log(' ', Object.values(r)[0]));
  console.log('=== TABLES in platform_admin_db ===');
  await conn.query('USE platform_admin_db');
  const [tables] = await conn.query('SHOW TABLES');
  tables.forEach((r) => console.log(' ', Object.values(r)[0]));
  console.log('=== DESCRIBE manage_company ===');
  const [cols] = await conn.query('DESCRIBE manage_company');
  cols.forEach((c) =>
    console.log(
      '  ' +
        c.Field +
        ' | ' +
        c.Type +
        ' | null=' +
        c.Null +
        ' | key=' +
        c.Key +
        ' | default=' +
        c.Default,
    ),
  );
  console.log('=== ROW COUNT ===');
  const [cnt] = await conn.query('SELECT COUNT(*) as total FROM manage_company');
  console.log('  Total:', cnt[0].total);
  const [stats] = await conn.query(
    'SELECT status, COUNT(*) as cnt FROM manage_company GROUP BY status',
  );
  stats.forEach((r) => console.log('  status=' + r.status + ': ' + r.cnt));
  console.log('=== SAMPLE ROWS (first 10) ===');
  const [rows] = await conn.query('SELECT * FROM manage_company LIMIT 10');
  rows.forEach((r, i) => console.log('Row' + i, JSON.stringify(r)));
  console.log('=== ACTIVE COMPANIES (status=1, first 15) ===');
  const [active] = await conn.query('SELECT * FROM manage_company WHERE status=1 LIMIT 15');
  active.forEach((r, i) => console.log('Active' + i, JSON.stringify(r)));
  await conn.end();
  console.log('Discovery complete.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
