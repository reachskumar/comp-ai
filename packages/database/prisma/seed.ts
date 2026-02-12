import 'dotenv/config';
import { PrismaClient, UserRole } from '../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Create tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme' },
    update: {},
    create: {
      name: 'Acme Corp',
      slug: 'acme',
      plan: 'enterprise',
      settings: { features: ['data-hygiene', 'rules-engine', 'comp-cycles', 'payroll'] },
    },
  });
  console.log(`  ✅ Tenant: ${tenant.name} (${tenant.id})`);

  // 2. Create admin user
  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@acme.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@acme.com',
      name: 'Alice Admin',
      role: UserRole.ADMIN,
    },
  });
  console.log(`  ✅ Admin: ${admin.name} (${admin.id})`);

  // 3. Create sample employees across 3 departments
  const employees = [
    { code: 'ENG-001', email: 'bob@acme.com', first: 'Bob', last: 'Builder', dept: 'Engineering', level: 'Senior', salary: 150000, total: 180000 },
    { code: 'ENG-002', email: 'carol@acme.com', first: 'Carol', last: 'Chen', dept: 'Engineering', level: 'Mid', salary: 120000, total: 140000 },
    { code: 'ENG-003', email: 'dave@acme.com', first: 'Dave', last: 'Davis', dept: 'Engineering', level: 'Junior', salary: 90000, total: 100000 },
    { code: 'ENG-004', email: 'eve@acme.com', first: 'Eve', last: 'Evans', dept: 'Engineering', level: 'Lead', salary: 175000, total: 210000 },
    { code: 'SAL-001', email: 'frank@acme.com', first: 'Frank', last: 'Fisher', dept: 'Sales', level: 'Senior', salary: 130000, total: 170000 },
    { code: 'SAL-002', email: 'grace@acme.com', first: 'Grace', last: 'Garcia', dept: 'Sales', level: 'Mid', salary: 100000, total: 130000 },
    { code: 'SAL-003', email: 'hank@acme.com', first: 'Hank', last: 'Hill', dept: 'Sales', level: 'Junior', salary: 80000, total: 95000 },
    { code: 'HR-001', email: 'iris@acme.com', first: 'Iris', last: 'Ito', dept: 'HR', level: 'Senior', salary: 125000, total: 145000 },
    { code: 'HR-002', email: 'jack@acme.com', first: 'Jack', last: 'Jones', dept: 'HR', level: 'Mid', salary: 105000, total: 120000 },
    { code: 'HR-003', email: 'kate@acme.com', first: 'Kate', last: 'Kim', dept: 'HR', level: 'Junior', salary: 85000, total: 95000 },
  ];

  const createdEmployees: { id: string; code: string; dept: string; level: string }[] = [];

  for (const emp of employees) {
    const employee = await prisma.employee.upsert({
      where: { tenantId_employeeCode: { tenantId: tenant.id, employeeCode: emp.code } },
      update: {},
      create: {
        tenantId: tenant.id,
        employeeCode: emp.code,
        email: emp.email,
        firstName: emp.first,
        lastName: emp.last,
        department: emp.dept,
        level: emp.level,
        location: 'San Francisco, CA',
        hireDate: new Date('2023-01-15'),
        currency: 'USD',
        baseSalary: emp.salary,
        totalComp: emp.total,
        metadata: { source: 'seed' },
      },
    });
    createdEmployees.push({ id: employee.id, code: emp.code, dept: emp.dept, level: emp.level });
  }
  console.log(`  ✅ Employees: ${createdEmployees.length} created`);

  // 4. Set up manager relationships (leads manage their department)
  const engLead = createdEmployees.find(e => e.code === 'ENG-004');
  const engTeam = createdEmployees.filter(e => e.dept === 'Engineering' && e.code !== 'ENG-004');
  if (engLead) {
    for (const member of engTeam) {
      await prisma.employee.update({ where: { id: member.id }, data: { managerId: engLead.id } });
    }
  }

  const salesLead = createdEmployees.find(e => e.code === 'SAL-001');
  const salesTeam = createdEmployees.filter(e => e.dept === 'Sales' && e.code !== 'SAL-001');
  if (salesLead) {
    for (const member of salesTeam) {
      await prisma.employee.update({ where: { id: member.id }, data: { managerId: salesLead.id } });
    }
  }

  const hrLead = createdEmployees.find(e => e.code === 'HR-001');
  const hrTeam = createdEmployees.filter(e => e.dept === 'HR' && e.code !== 'HR-001');
  if (hrLead) {
    for (const member of hrTeam) {
      await prisma.employee.update({ where: { id: member.id }, data: { managerId: hrLead.id } });
    }
  }
  console.log('  ✅ Manager relationships set');

  // 5. Create a notification for admin
  await prisma.notification.upsert({
    where: { id: 'seed-notification-1' },
    update: {},
    create: {
      id: 'seed-notification-1',
      tenantId: tenant.id,
      userId: admin.id,
      type: 'system',
      title: 'Welcome to Compensation Platform',
      body: 'Your workspace is ready. Start by importing employee data or configuring compensation rules.',
      metadata: { category: 'onboarding' },
    },
  });
  console.log('  ✅ Notification created');

  console.log('🎉 Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

