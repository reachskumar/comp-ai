import 'dotenv/config';
import {
  PrismaClient,
  UserRole,
  CycleType,
  CycleStatus,
  RecommendationType,
  RecommendationStatus,
  RuleSetStatus,
  RuleType,
  BenefitPlanType,
  BenefitTier,
  EnrollmentStatus,
  PayrollStatus,
  AnomalyType,
  AnomalySeverity,
  ComplianceScanStatus,
  ComplianceFindingSeverity,
  ComplianceFindingCategory,
  ConnectorType,
  ConnectorStatus,
  SyncDirection,
  SyncSchedule,
  SyncJobStatus,
  LetterType,
  LetterStatus,
  ReportStatus,
  EnrollmentWindowStatus,
  LifeEventType,
  DependentRelationship,
  ConflictStrategy,
  MarketDataProvider,
  StatementStatus,
  EquityGrantType,
  EquityGrantStatus,
  VestingScheduleType,
  VestingEventStatus,
} from '../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcryptjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...');

  // Hash passwords (bcrypt cost factor 12 per spec)
  const adminPasswordHash = await bcrypt.hash('Admin123!@#', 12);
  const demoPasswordHash = await bcrypt.hash('Demo123!@#', 12);

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
    update: { passwordHash: adminPasswordHash },
    create: {
      tenantId: tenant.id,
      email: 'admin@acme.com',
      name: 'Alice Admin',
      role: UserRole.ADMIN,
      passwordHash: adminPasswordHash,
    },
  });
  console.log(`  ✅ Admin: ${admin.name} (${admin.id})`);

  // 2b. Create demo user with known credentials (demo@compport.com / Demo123!@#)
  const demo = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'demo@compport.com' } },
    update: { passwordHash: demoPasswordHash },
    create: {
      tenantId: tenant.id,
      email: 'demo@compport.com',
      name: 'Demo User',
      role: UserRole.ADMIN,
      passwordHash: demoPasswordHash,
    },
  });
  console.log(`  ✅ Demo: ${demo.name} (${demo.id})`);

  // 3. Create 50 employees across 7 departments, 5 locations
  const employees = [
    // ── Engineering (12) ──
    {
      code: 'ENG-001',
      email: 'rajesh.kumar@acme.com',
      first: 'Rajesh',
      last: 'Kumar',
      dept: 'Engineering',
      level: 'VP',
      salary: 220000,
      total: 280000,
      location: 'San Francisco, CA',
      hire: '2019-03-15',
      gender: 'M',
    },
    {
      code: 'ENG-002',
      email: 'sarah.chen@acme.com',
      first: 'Sarah',
      last: 'Chen',
      dept: 'Engineering',
      level: 'Director',
      salary: 195000,
      total: 245000,
      location: 'San Francisco, CA',
      hire: '2019-08-01',
      gender: 'F',
    },
    {
      code: 'ENG-003',
      email: 'marcus.johnson@acme.com',
      first: 'Marcus',
      last: 'Johnson',
      dept: 'Engineering',
      level: 'Senior',
      salary: 175000,
      total: 215000,
      location: 'San Francisco, CA',
      hire: '2020-01-10',
      gender: 'M',
    },
    {
      code: 'ENG-004',
      email: 'priya.patel@acme.com',
      first: 'Priya',
      last: 'Patel',
      dept: 'Engineering',
      level: 'Senior',
      salary: 168000,
      total: 208000,
      location: 'Bangalore, IN',
      hire: '2020-06-15',
      gender: 'F',
    },
    {
      code: 'ENG-005',
      email: 'james.wilson@acme.com',
      first: 'James',
      last: 'Wilson',
      dept: 'Engineering',
      level: 'Senior',
      salary: 170000,
      total: 210000,
      location: 'Austin, TX',
      hire: '2020-09-01',
      gender: 'M',
    },
    {
      code: 'ENG-006',
      email: 'mei.zhang@acme.com',
      first: 'Mei',
      last: 'Zhang',
      dept: 'Engineering',
      level: 'Mid',
      salary: 140000,
      total: 170000,
      location: 'San Francisco, CA',
      hire: '2021-03-20',
      gender: 'F',
    },
    {
      code: 'ENG-007',
      email: 'david.oconnor@acme.com',
      first: 'David',
      last: "O'Connor",
      dept: 'Engineering',
      level: 'Mid',
      salary: 135000,
      total: 165000,
      location: 'New York, NY',
      hire: '2021-07-12',
      gender: 'M',
    },
    {
      code: 'ENG-008',
      email: 'aisha.mohammed@acme.com',
      first: 'Aisha',
      last: 'Mohammed',
      dept: 'Engineering',
      level: 'Mid',
      salary: 130000,
      total: 158000,
      location: 'London, UK',
      hire: '2022-01-05',
      gender: 'F',
    },
    {
      code: 'ENG-009',
      email: 'carlos.rivera@acme.com',
      first: 'Carlos',
      last: 'Rivera',
      dept: 'Engineering',
      level: 'Junior',
      salary: 95000,
      total: 110000,
      location: 'Austin, TX',
      hire: '2023-06-01',
      gender: 'M',
    },
    {
      code: 'ENG-010',
      email: 'emma.taylor@acme.com',
      first: 'Emma',
      last: 'Taylor',
      dept: 'Engineering',
      level: 'Junior',
      salary: 90000,
      total: 105000,
      location: 'San Francisco, CA',
      hire: '2024-01-15',
      gender: 'F',
    },
    {
      code: 'ENG-011',
      email: 'arjun.reddy@acme.com',
      first: 'Arjun',
      last: 'Reddy',
      dept: 'Engineering',
      level: 'Junior',
      salary: 85000,
      total: 98000,
      location: 'Bangalore, IN',
      hire: '2024-06-01',
      gender: 'M',
    },
    {
      code: 'ENG-012',
      email: 'sofia.martinez@acme.com',
      first: 'Sofia',
      last: 'Martinez',
      dept: 'Engineering',
      level: 'Junior',
      salary: 88000,
      total: 102000,
      location: 'Austin, TX',
      hire: '2025-01-10',
      gender: 'F',
    },
    // ── Sales (8) ──
    {
      code: 'SAL-001',
      email: 'michael.brooks@acme.com',
      first: 'Michael',
      last: 'Brooks',
      dept: 'Sales',
      level: 'VP',
      salary: 200000,
      total: 300000,
      location: 'New York, NY',
      hire: '2019-05-20',
      gender: 'M',
    },
    {
      code: 'SAL-002',
      email: 'jennifer.lee@acme.com',
      first: 'Jennifer',
      last: 'Lee',
      dept: 'Sales',
      level: 'Director',
      salary: 175000,
      total: 250000,
      location: 'New York, NY',
      hire: '2020-02-01',
      gender: 'F',
    },
    {
      code: 'SAL-003',
      email: 'robert.thompson@acme.com',
      first: 'Robert',
      last: 'Thompson',
      dept: 'Sales',
      level: 'Senior',
      salary: 150000,
      total: 220000,
      location: 'New York, NY',
      hire: '2020-08-15',
      gender: 'M',
    },
    {
      code: 'SAL-004',
      email: 'lisa.nguyen@acme.com',
      first: 'Lisa',
      last: 'Nguyen',
      dept: 'Sales',
      level: 'Senior',
      salary: 145000,
      total: 210000,
      location: 'San Francisco, CA',
      hire: '2021-01-10',
      gender: 'F',
    },
    {
      code: 'SAL-005',
      email: 'daniel.garcia@acme.com',
      first: 'Daniel',
      last: 'Garcia',
      dept: 'Sales',
      level: 'Mid',
      salary: 115000,
      total: 165000,
      location: 'Austin, TX',
      hire: '2022-03-01',
      gender: 'M',
    },
    {
      code: 'SAL-006',
      email: 'amanda.white@acme.com',
      first: 'Amanda',
      last: 'White',
      dept: 'Sales',
      level: 'Mid',
      salary: 110000,
      total: 155000,
      location: 'New York, NY',
      hire: '2022-09-15',
      gender: 'F',
    },
    {
      code: 'SAL-007',
      email: 'kevin.brown@acme.com',
      first: 'Kevin',
      last: 'Brown',
      dept: 'Sales',
      level: 'Junior',
      salary: 80000,
      total: 110000,
      location: 'Austin, TX',
      hire: '2023-07-01',
      gender: 'M',
    },
    {
      code: 'SAL-008',
      email: 'rachel.davis@acme.com',
      first: 'Rachel',
      last: 'Davis',
      dept: 'Sales',
      level: 'Junior',
      salary: 78000,
      total: 105000,
      location: 'New York, NY',
      hire: '2024-03-01',
      gender: 'F',
    },
    // ── HR (6) ──
    {
      code: 'HR-001',
      email: 'patricia.williams@acme.com',
      first: 'Patricia',
      last: 'Williams',
      dept: 'HR',
      level: 'VP',
      salary: 190000,
      total: 240000,
      location: 'San Francisco, CA',
      hire: '2019-04-01',
      gender: 'F',
    },
    {
      code: 'HR-002',
      email: 'thomas.anderson@acme.com',
      first: 'Thomas',
      last: 'Anderson',
      dept: 'HR',
      level: 'Director',
      salary: 165000,
      total: 205000,
      location: 'San Francisco, CA',
      hire: '2020-03-15',
      gender: 'M',
    },
    {
      code: 'HR-003',
      email: 'maria.santos@acme.com',
      first: 'Maria',
      last: 'Santos',
      dept: 'HR',
      level: 'Senior',
      salary: 135000,
      total: 165000,
      location: 'New York, NY',
      hire: '2021-05-01',
      gender: 'F',
    },
    {
      code: 'HR-004',
      email: 'william.clark@acme.com',
      first: 'William',
      last: 'Clark',
      dept: 'HR',
      level: 'Mid',
      salary: 110000,
      total: 132000,
      location: 'San Francisco, CA',
      hire: '2022-06-15',
      gender: 'M',
    },
    {
      code: 'HR-005',
      email: 'nina.kowalski@acme.com',
      first: 'Nina',
      last: 'Kowalski',
      dept: 'HR',
      level: 'Junior',
      salary: 82000,
      total: 96000,
      location: 'London, UK',
      hire: '2023-09-01',
      gender: 'F',
    },
    {
      code: 'HR-006',
      email: 'jason.wright@acme.com',
      first: 'Jason',
      last: 'Wright',
      dept: 'HR',
      level: 'Junior',
      salary: 78000,
      total: 92000,
      location: 'Austin, TX',
      hire: '2024-07-01',
      gender: 'M',
    },
    // ── Finance (8) ──
    {
      code: 'FIN-001',
      email: 'elizabeth.morgan@acme.com',
      first: 'Elizabeth',
      last: 'Morgan',
      dept: 'Finance',
      level: 'VP',
      salary: 210000,
      total: 265000,
      location: 'New York, NY',
      hire: '2019-06-01',
      gender: 'F',
    },
    {
      code: 'FIN-002',
      email: 'christopher.hall@acme.com',
      first: 'Christopher',
      last: 'Hall',
      dept: 'Finance',
      level: 'Director',
      salary: 180000,
      total: 225000,
      location: 'New York, NY',
      hire: '2019-11-15',
      gender: 'M',
    },
    {
      code: 'FIN-003',
      email: 'angela.kim@acme.com',
      first: 'Angela',
      last: 'Kim',
      dept: 'Finance',
      level: 'Senior',
      salary: 155000,
      total: 190000,
      location: 'San Francisco, CA',
      hire: '2020-04-01',
      gender: 'F',
    },
    {
      code: 'FIN-004',
      email: 'matthew.young@acme.com',
      first: 'Matthew',
      last: 'Young',
      dept: 'Finance',
      level: 'Senior',
      salary: 150000,
      total: 185000,
      location: 'New York, NY',
      hire: '2021-02-15',
      gender: 'M',
    },
    {
      code: 'FIN-005',
      email: 'stephanie.liu@acme.com',
      first: 'Stephanie',
      last: 'Liu',
      dept: 'Finance',
      level: 'Mid',
      salary: 120000,
      total: 148000,
      location: 'San Francisco, CA',
      hire: '2022-01-10',
      gender: 'F',
    },
    {
      code: 'FIN-006',
      email: 'andrew.jackson@acme.com',
      first: 'Andrew',
      last: 'Jackson',
      dept: 'Finance',
      level: 'Mid',
      salary: 115000,
      total: 142000,
      location: 'London, UK',
      hire: '2022-08-01',
      gender: 'M',
    },
    {
      code: 'FIN-007',
      email: 'jessica.hernandez@acme.com',
      first: 'Jessica',
      last: 'Hernandez',
      dept: 'Finance',
      level: 'Junior',
      salary: 85000,
      total: 100000,
      location: 'Austin, TX',
      hire: '2023-10-01',
      gender: 'F',
    },
    {
      code: 'FIN-008',
      email: 'ryan.scott@acme.com',
      first: 'Ryan',
      last: 'Scott',
      dept: 'Finance',
      level: 'Junior',
      salary: 82000,
      total: 96000,
      location: 'New York, NY',
      hire: '2024-05-15',
      gender: 'M',
    },
    // ── Marketing (6) ──
    {
      code: 'MKT-001',
      email: 'diana.foster@acme.com',
      first: 'Diana',
      last: 'Foster',
      dept: 'Marketing',
      level: 'VP',
      salary: 185000,
      total: 235000,
      location: 'San Francisco, CA',
      hire: '2019-07-15',
      gender: 'F',
    },
    {
      code: 'MKT-002',
      email: 'brian.murphy@acme.com',
      first: 'Brian',
      last: 'Murphy',
      dept: 'Marketing',
      level: 'Director',
      salary: 160000,
      total: 200000,
      location: 'New York, NY',
      hire: '2020-05-01',
      gender: 'M',
    },
    {
      code: 'MKT-003',
      email: 'samantha.ross@acme.com',
      first: 'Samantha',
      last: 'Ross',
      dept: 'Marketing',
      level: 'Senior',
      salary: 140000,
      total: 172000,
      location: 'San Francisco, CA',
      hire: '2021-04-15',
      gender: 'F',
    },
    {
      code: 'MKT-004',
      email: 'tyler.reed@acme.com',
      first: 'Tyler',
      last: 'Reed',
      dept: 'Marketing',
      level: 'Mid',
      salary: 105000,
      total: 128000,
      location: 'Austin, TX',
      hire: '2022-07-01',
      gender: 'M',
    },
    {
      code: 'MKT-005',
      email: 'olivia.bennett@acme.com',
      first: 'Olivia',
      last: 'Bennett',
      dept: 'Marketing',
      level: 'Junior',
      salary: 75000,
      total: 88000,
      location: 'London, UK',
      hire: '2023-11-01',
      gender: 'F',
    },
    {
      code: 'MKT-006',
      email: 'nathan.cooper@acme.com',
      first: 'Nathan',
      last: 'Cooper',
      dept: 'Marketing',
      level: 'Junior',
      salary: 72000,
      total: 85000,
      location: 'San Francisco, CA',
      hire: '2024-08-15',
      gender: 'M',
    },
    // ── Product (6) ──
    {
      code: 'PRD-001',
      email: 'laura.mitchell@acme.com',
      first: 'Laura',
      last: 'Mitchell',
      dept: 'Product',
      level: 'VP',
      salary: 195000,
      total: 250000,
      location: 'San Francisco, CA',
      hire: '2019-09-01',
      gender: 'F',
    },
    {
      code: 'PRD-002',
      email: 'alex.turner@acme.com',
      first: 'Alex',
      last: 'Turner',
      dept: 'Product',
      level: 'Director',
      salary: 170000,
      total: 215000,
      location: 'San Francisco, CA',
      hire: '2020-07-15',
      gender: 'M',
    },
    {
      code: 'PRD-003',
      email: 'hannah.phillips@acme.com',
      first: 'Hannah',
      last: 'Phillips',
      dept: 'Product',
      level: 'Senior',
      salary: 155000,
      total: 192000,
      location: 'New York, NY',
      hire: '2021-06-01',
      gender: 'F',
    },
    {
      code: 'PRD-004',
      email: 'ethan.campbell@acme.com',
      first: 'Ethan',
      last: 'Campbell',
      dept: 'Product',
      level: 'Mid',
      salary: 125000,
      total: 152000,
      location: 'Austin, TX',
      hire: '2022-04-15',
      gender: 'M',
    },
    {
      code: 'PRD-005',
      email: 'chloe.parker@acme.com',
      first: 'Chloe',
      last: 'Parker',
      dept: 'Product',
      level: 'Junior',
      salary: 88000,
      total: 104000,
      location: 'San Francisco, CA',
      hire: '2023-08-01',
      gender: 'F',
    },
    {
      code: 'PRD-006',
      email: 'liam.stewart@acme.com',
      first: 'Liam',
      last: 'Stewart',
      dept: 'Product',
      level: 'Junior',
      salary: 85000,
      total: 100000,
      location: 'London, UK',
      hire: '2024-04-01',
      gender: 'M',
    },
    // ── Legal (4) ──
    {
      code: 'LEG-001',
      email: 'victoria.adams@acme.com',
      first: 'Victoria',
      last: 'Adams',
      dept: 'Legal',
      level: 'VP',
      salary: 205000,
      total: 255000,
      location: 'New York, NY',
      hire: '2019-10-15',
      gender: 'F',
    },
    {
      code: 'LEG-002',
      email: 'richard.baker@acme.com',
      first: 'Richard',
      last: 'Baker',
      dept: 'Legal',
      level: 'Senior',
      salary: 165000,
      total: 200000,
      location: 'New York, NY',
      hire: '2020-11-01',
      gender: 'M',
    },
    {
      code: 'LEG-003',
      email: 'katherine.green@acme.com',
      first: 'Katherine',
      last: 'Green',
      dept: 'Legal',
      level: 'Mid',
      salary: 130000,
      total: 158000,
      location: 'San Francisco, CA',
      hire: '2022-02-15',
      gender: 'F',
    },
    {
      code: 'LEG-004',
      email: 'samuel.wright@acme.com',
      first: 'Samuel',
      last: 'Wright',
      dept: 'Legal',
      level: 'Junior',
      salary: 95000,
      total: 112000,
      location: 'New York, NY',
      hire: '2023-05-01',
      gender: 'M',
    },
  ];

  const createdEmployees: {
    id: string;
    code: string;
    dept: string;
    level: string;
    salary: number;
  }[] = [];

  for (const emp of employees) {
    const currency = emp.location.includes('UK')
      ? 'GBP'
      : emp.location.includes('IN')
        ? 'INR'
        : 'USD';
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
        location: emp.location,
        hireDate: new Date(emp.hire),
        currency,
        baseSalary: emp.salary,
        totalComp: emp.total,
        metadata: { source: 'seed', gender: emp.gender },
      },
    });
    createdEmployees.push({
      id: employee.id,
      code: emp.code,
      dept: emp.dept,
      level: emp.level,
      salary: emp.salary,
    });
  }
  console.log(`  ✅ Employees: ${createdEmployees.length} created`);

  // 4. Set up manager relationships — VP manages department, Director reports to VP
  const deptLeaders: Record<string, string> = {
    Engineering: 'ENG-001',
    Sales: 'SAL-001',
    HR: 'HR-001',
    Finance: 'FIN-001',
    Marketing: 'MKT-001',
    Product: 'PRD-001',
    Legal: 'LEG-001',
  };
  for (const [dept, leaderCode] of Object.entries(deptLeaders)) {
    const leader = createdEmployees.find((e) => e.code === leaderCode);
    if (!leader) continue;
    const team = createdEmployees.filter((e) => e.dept === dept && e.code !== leaderCode);
    for (const member of team) {
      await prisma.employee.update({ where: { id: member.id }, data: { managerId: leader.id } });
    }
  }
  console.log('  ✅ Manager relationships set');

  // 4a. Add performance ratings to all employees
  const perfRatingCycle = [
    4, 3, 5, 3, 4, 2, 3, 4, 3, 5, 3, 4, 2, 3, 4, 5, 3, 4, 3, 2, 4, 3, 5, 3, 4, 3, 4, 2, 3, 5, 4, 3,
    3, 4, 5, 3, 2, 4, 3, 4, 3, 5, 4, 3, 3, 4, 2, 3, 4, 5,
  ];
  for (let i = 0; i < createdEmployees.length; i++) {
    const emp = createdEmployees[i]!;
    await prisma.employee.update({
      where: { id: emp.id },
      data: { performanceRating: perfRatingCycle[i % perfRatingCycle.length] },
    });
  }
  console.log('  ✅ Performance ratings set');

  // 4a2. Create default merit matrix
  const defaultMatrixCells = [
    { perfRating: 5, compaRatioRange: '<0.80', increasePercent: 7.0 },
    { perfRating: 5, compaRatioRange: '0.80-0.90', increasePercent: 6.0 },
    { perfRating: 5, compaRatioRange: '0.90-1.00', increasePercent: 5.0 },
    { perfRating: 5, compaRatioRange: '1.00-1.10', increasePercent: 4.0 },
    { perfRating: 5, compaRatioRange: '1.10-1.20', increasePercent: 3.0 },
    { perfRating: 5, compaRatioRange: '>1.20', increasePercent: 2.0 },
    { perfRating: 4, compaRatioRange: '<0.80', increasePercent: 6.0 },
    { perfRating: 4, compaRatioRange: '0.80-0.90', increasePercent: 5.0 },
    { perfRating: 4, compaRatioRange: '0.90-1.00', increasePercent: 4.0 },
    { perfRating: 4, compaRatioRange: '1.00-1.10', increasePercent: 3.0 },
    { perfRating: 4, compaRatioRange: '1.10-1.20', increasePercent: 2.5 },
    { perfRating: 4, compaRatioRange: '>1.20', increasePercent: 1.5 },
    { perfRating: 3, compaRatioRange: '<0.80', increasePercent: 5.0 },
    { perfRating: 3, compaRatioRange: '0.80-0.90', increasePercent: 4.0 },
    { perfRating: 3, compaRatioRange: '0.90-1.00', increasePercent: 3.0 },
    { perfRating: 3, compaRatioRange: '1.00-1.10', increasePercent: 2.5 },
    { perfRating: 3, compaRatioRange: '1.10-1.20', increasePercent: 2.0 },
    { perfRating: 3, compaRatioRange: '>1.20', increasePercent: 1.0 },
    { perfRating: 2, compaRatioRange: '<0.80', increasePercent: 3.0 },
    { perfRating: 2, compaRatioRange: '0.80-0.90', increasePercent: 2.0 },
    { perfRating: 2, compaRatioRange: '0.90-1.00', increasePercent: 1.5 },
    { perfRating: 2, compaRatioRange: '1.00-1.10', increasePercent: 1.0 },
    { perfRating: 2, compaRatioRange: '1.10-1.20', increasePercent: 0.5 },
    { perfRating: 2, compaRatioRange: '>1.20', increasePercent: 0 },
    { perfRating: 1, compaRatioRange: '<0.80', increasePercent: 1.0 },
    { perfRating: 1, compaRatioRange: '0.80-0.90', increasePercent: 0.5 },
    { perfRating: 1, compaRatioRange: '0.90-1.00', increasePercent: 0 },
    { perfRating: 1, compaRatioRange: '1.00-1.10', increasePercent: 0 },
    { perfRating: 1, compaRatioRange: '1.10-1.20', increasePercent: 0 },
    { perfRating: 1, compaRatioRange: '>1.20', increasePercent: 0 },
  ];
  await prisma.meritMatrix.upsert({
    where: { id: 'seed-merit-matrix-default' },
    update: {},
    create: {
      id: 'seed-merit-matrix-default',
      tenantId: tenant.id,
      name: 'FY2026 Standard Merit Matrix',
      isDefault: true,
      matrix: defaultMatrixCells,
    },
  });
  console.log('  ✅ Default merit matrix created');

  // ─────────────────────────────────────────────────────────────
  // 4b. Salary Bands & Market Data Sources (Benchmarking)
  // ─────────────────────────────────────────────────────────────
  const salaryBandsData = [
    // Engineering
    {
      id: 'seed-band-eng-vp',
      jobFamily: 'Engineering',
      level: 'VP',
      p10: 190000,
      p25: 205000,
      p50: 225000,
      p75: 250000,
      p90: 280000,
    },
    {
      id: 'seed-band-eng-dir',
      jobFamily: 'Engineering',
      level: 'Director',
      p10: 170000,
      p25: 185000,
      p50: 200000,
      p75: 220000,
      p90: 245000,
    },
    {
      id: 'seed-band-eng-sr',
      jobFamily: 'Engineering',
      level: 'Senior',
      p10: 150000,
      p25: 162000,
      p50: 175000,
      p75: 190000,
      p90: 210000,
    },
    {
      id: 'seed-band-eng-mid',
      jobFamily: 'Engineering',
      level: 'Mid',
      p10: 115000,
      p25: 125000,
      p50: 138000,
      p75: 150000,
      p90: 165000,
    },
    {
      id: 'seed-band-eng-jr',
      jobFamily: 'Engineering',
      level: 'Junior',
      p10: 75000,
      p25: 82000,
      p50: 92000,
      p75: 102000,
      p90: 115000,
    },
    // Sales
    {
      id: 'seed-band-sal-vp',
      jobFamily: 'Sales',
      level: 'VP',
      p10: 175000,
      p25: 190000,
      p50: 205000,
      p75: 230000,
      p90: 260000,
    },
    {
      id: 'seed-band-sal-dir',
      jobFamily: 'Sales',
      level: 'Director',
      p10: 155000,
      p25: 168000,
      p50: 180000,
      p75: 200000,
      p90: 225000,
    },
    {
      id: 'seed-band-sal-sr',
      jobFamily: 'Sales',
      level: 'Senior',
      p10: 130000,
      p25: 140000,
      p50: 152000,
      p75: 168000,
      p90: 185000,
    },
    {
      id: 'seed-band-sal-mid',
      jobFamily: 'Sales',
      level: 'Mid',
      p10: 95000,
      p25: 105000,
      p50: 115000,
      p75: 128000,
      p90: 142000,
    },
    {
      id: 'seed-band-sal-jr',
      jobFamily: 'Sales',
      level: 'Junior',
      p10: 65000,
      p25: 72000,
      p50: 80000,
      p75: 90000,
      p90: 100000,
    },
    // HR
    {
      id: 'seed-band-hr-vp',
      jobFamily: 'HR',
      level: 'VP',
      p10: 165000,
      p25: 178000,
      p50: 192000,
      p75: 215000,
      p90: 240000,
    },
    {
      id: 'seed-band-hr-dir',
      jobFamily: 'HR',
      level: 'Director',
      p10: 145000,
      p25: 155000,
      p50: 168000,
      p75: 185000,
      p90: 205000,
    },
    {
      id: 'seed-band-hr-sr',
      jobFamily: 'HR',
      level: 'Senior',
      p10: 115000,
      p25: 125000,
      p50: 138000,
      p75: 152000,
      p90: 168000,
    },
    {
      id: 'seed-band-hr-mid',
      jobFamily: 'HR',
      level: 'Mid',
      p10: 88000,
      p25: 98000,
      p50: 110000,
      p75: 122000,
      p90: 135000,
    },
    {
      id: 'seed-band-hr-jr',
      jobFamily: 'HR',
      level: 'Junior',
      p10: 62000,
      p25: 70000,
      p50: 80000,
      p75: 90000,
      p90: 100000,
    },
    // Finance
    {
      id: 'seed-band-fin-vp',
      jobFamily: 'Finance',
      level: 'VP',
      p10: 185000,
      p25: 198000,
      p50: 215000,
      p75: 240000,
      p90: 270000,
    },
    {
      id: 'seed-band-fin-dir',
      jobFamily: 'Finance',
      level: 'Director',
      p10: 160000,
      p25: 172000,
      p50: 185000,
      p75: 205000,
      p90: 228000,
    },
    {
      id: 'seed-band-fin-sr',
      jobFamily: 'Finance',
      level: 'Senior',
      p10: 135000,
      p25: 145000,
      p50: 158000,
      p75: 172000,
      p90: 190000,
    },
    {
      id: 'seed-band-fin-mid',
      jobFamily: 'Finance',
      level: 'Mid',
      p10: 100000,
      p25: 110000,
      p50: 122000,
      p75: 135000,
      p90: 150000,
    },
    {
      id: 'seed-band-fin-jr',
      jobFamily: 'Finance',
      level: 'Junior',
      p10: 68000,
      p25: 75000,
      p50: 85000,
      p75: 95000,
      p90: 108000,
    },
  ];

  const createdBands: Record<string, string> = {};
  for (const band of salaryBandsData) {
    const created = await prisma.salaryBand.upsert({
      where: { id: band.id },
      update: {},
      create: {
        id: band.id,
        tenantId: tenant.id,
        jobFamily: band.jobFamily,
        level: band.level,
        currency: 'USD',
        p10: band.p10,
        p25: band.p25,
        p50: band.p50,
        p75: band.p75,
        p90: band.p90,
        source: 'Radford Global Technology Survey 2026',
        effectiveDate: new Date('2026-01-01'),
        expiresAt: new Date('2026-12-31'),
      },
    });
    createdBands[`${band.jobFamily}-${band.level}`] = created.id;
  }
  console.log(`  ✅ Salary Bands: ${salaryBandsData.length} created`);

  // Assign salary bands and calculate compa-ratios for employees
  for (const emp of createdEmployees) {
    const bandKey = `${emp.dept}-${emp.level}`;
    const bandId = createdBands[bandKey];
    if (bandId) {
      const band = salaryBandsData.find((b) => `${b.jobFamily}-${b.level}` === bandKey);
      const compaRatio = band ? emp.salary / band.p50 : null;
      await prisma.employee.update({
        where: { id: emp.id },
        data: {
          jobFamily: emp.dept,
          salaryBandId: bandId,
          compaRatio: compaRatio ? Math.round(compaRatio * 10000) / 10000 : null,
        },
      });
    }
  }
  console.log('  ✅ Employee compa-ratios calculated');

  // Market Data Sources
  const marketSources = [
    {
      id: 'seed-mds-radford',
      name: 'Radford Global Technology Survey',
      provider: MarketDataProvider.SURVEY,
    },
    {
      id: 'seed-mds-manual',
      name: 'Internal Compensation Review',
      provider: MarketDataProvider.MANUAL,
    },
    { id: 'seed-mds-payscale', name: 'PayScale Market Data API', provider: MarketDataProvider.API },
  ];
  for (const src of marketSources) {
    await prisma.marketDataSource.upsert({
      where: { id: src.id },
      update: {},
      create: {
        id: src.id,
        tenantId: tenant.id,
        name: src.name,
        provider: src.provider,
        config: {},
        lastSyncAt: src.provider === MarketDataProvider.SURVEY ? new Date('2026-01-15') : null,
      },
    });
  }
  console.log(`  ✅ Market Data Sources: ${marketSources.length} created`);

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

  // ─────────────────────────────────────────────────────────────
  // 6. Compensation Cycles (3 total)
  // ─────────────────────────────────────────────────────────────
  const meritCycle = await prisma.compCycle.upsert({
    where: { id: 'seed-cycle-merit-2026' },
    update: {},
    create: {
      id: 'seed-cycle-merit-2026',
      tenantId: tenant.id,
      name: '2026 Annual Merit Review',
      cycleType: CycleType.MERIT,
      status: CycleStatus.ACTIVE,
      budgetTotal: 750000,
      currency: 'USD',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-03-31'),
      settings: { guidelinePct: 3.5, maxPct: 8, minPct: 0 },
    },
  });

  const bonusCycle = await prisma.compCycle.upsert({
    where: { id: 'seed-cycle-bonus-q4' },
    update: {},
    create: {
      id: 'seed-cycle-bonus-q4',
      tenantId: tenant.id,
      name: '2025 Q4 Bonus',
      cycleType: CycleType.BONUS,
      status: CycleStatus.COMPLETED,
      budgetTotal: 350000,
      currency: 'USD',
      startDate: new Date('2025-10-01'),
      endDate: new Date('2025-12-31'),
      settings: { targetPct: 10, maxPct: 20 },
    },
  });

  const promoCycle = await prisma.compCycle.upsert({
    where: { id: 'seed-cycle-promo-2026' },
    update: {},
    create: {
      id: 'seed-cycle-promo-2026',
      tenantId: tenant.id,
      name: '2026 Promotion Cycle',
      cycleType: CycleType.MERIT,
      status: CycleStatus.PLANNING,
      budgetTotal: 400000,
      currency: 'USD',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-06-30'),
      settings: { minTenureMonths: 18, requiresPerformanceReview: true },
    },
  });
  console.log(`  ✅ Comp Cycles: ${meritCycle.name}, ${bonusCycle.name}, ${promoCycle.name}`);

  // Cycle Budgets for merit cycle — all 7 departments
  const allDepts = ['Engineering', 'Sales', 'HR', 'Finance', 'Marketing', 'Product', 'Legal'];
  const deptBudgets: Record<string, { allocated: number; spentPct: number; drift: number }> = {
    Engineering: { allocated: 200000, spentPct: 0.65, drift: 2.1 },
    Sales: { allocated: 130000, spentPct: 0.55, drift: 1.5 },
    HR: { allocated: 80000, spentPct: 0.7, drift: 0.8 },
    Finance: { allocated: 120000, spentPct: 0.6, drift: 1.2 },
    Marketing: { allocated: 75000, spentPct: 0.45, drift: -0.5 },
    Product: { allocated: 95000, spentPct: 0.5, drift: 0.3 },
    Legal: { allocated: 50000, spentPct: 0.4, drift: -1.0 },
  };
  for (const dept of allDepts) {
    const leader = createdEmployees.find((e) => e.dept === dept && e.code === deptLeaders[dept]);
    const b = deptBudgets[dept]!;
    const spent = Math.round(b.allocated * b.spentPct);
    await prisma.cycleBudget.upsert({
      where: { id: `seed-budget-${dept.toLowerCase()}` },
      update: {},
      create: {
        id: `seed-budget-${dept.toLowerCase()}`,
        cycleId: meritCycle.id,
        department: dept,
        managerId: leader?.id ?? null,
        allocated: b.allocated,
        spent,
        remaining: b.allocated - spent,
        driftPct: b.drift,
      },
    });
  }
  console.log('  ✅ Cycle Budgets: 7 departments');

  // ─────────────────────────────────────────────────────────────
  // 7. Compensation Recommendations (one per employee in merit cycle)
  // ─────────────────────────────────────────────────────────────
  const recStatusCycle: RecommendationStatus[] = [
    RecommendationStatus.APPROVED,
    RecommendationStatus.SUBMITTED,
    RecommendationStatus.DRAFT,
    RecommendationStatus.APPROVED,
    RecommendationStatus.REJECTED,
    RecommendationStatus.SUBMITTED,
    RecommendationStatus.APPROVED,
    RecommendationStatus.DRAFT,
    RecommendationStatus.SUBMITTED,
    RecommendationStatus.APPROVED,
  ];

  for (let i = 0; i < createdEmployees.length; i++) {
    const emp = createdEmployees[i]!;
    const pct = 2.0 + (i % 7) * 0.8; // 2.0% to 6.8% spread
    const proposedSalary = Math.round(emp.salary * (1 + pct / 100));
    const status = recStatusCycle[i % recStatusCycle.length]!;
    await prisma.compRecommendation.upsert({
      where: { id: `seed-rec-${emp.code}` },
      update: {},
      create: {
        id: `seed-rec-${emp.code}`,
        cycleId: meritCycle.id,
        employeeId: emp.id,
        recType: RecommendationType.MERIT_INCREASE,
        currentValue: emp.salary,
        proposedValue: proposedSalary,
        justification: `${pct.toFixed(1)}% merit increase based on performance review and market data.`,
        status,
        approverUserId: status === RecommendationStatus.APPROVED ? admin.id : null,
        approvedAt: status === RecommendationStatus.APPROVED ? new Date('2026-02-01') : null,
      },
    });
  }
  console.log(`  ✅ Recommendations: ${createdEmployees.length} created`);

  // ─────────────────────────────────────────────────────────────
  // 8. Rule Sets with Rules
  // ─────────────────────────────────────────────────────────────
  const meritRuleSet = await prisma.ruleSet.upsert({
    where: { id: 'seed-ruleset-merit' },
    update: {},
    create: {
      id: 'seed-ruleset-merit',
      tenantId: tenant.id,
      name: 'Standard Merit Rules',
      description: 'Default merit increase rules based on performance rating and tenure.',
      version: 1,
      status: RuleSetStatus.ACTIVE,
      effectiveDate: new Date('2026-01-01'),
      schema: { type: 'merit', version: '1.0' },
    },
  });

  const meritRules = [
    {
      id: 'seed-rule-merit-cap',
      name: 'Merit Cap Rule',
      ruleType: RuleType.CAP,
      priority: 1,
      conditions: { maxIncreasePct: 8, appliesTo: 'all' },
      actions: { capAt: 8, notify: true },
      metadata: { description: 'No merit increase may exceed 8%' },
    },
    {
      id: 'seed-rule-merit-floor',
      name: 'Merit Floor Rule',
      ruleType: RuleType.FLOOR,
      priority: 2,
      conditions: { minIncreasePct: 1.5, performanceRating: { gte: 'meets_expectations' } },
      actions: { floorAt: 1.5 },
      metadata: { description: 'Minimum 1.5% for employees meeting expectations' },
    },
    {
      id: 'seed-rule-merit-proration',
      name: 'Tenure Proration Rule',
      ruleType: RuleType.PRORATION,
      priority: 3,
      conditions: { tenureMonths: { lt: 12 } },
      actions: { prorateFactor: 'tenureMonths / 12' },
      metadata: { description: 'Pro-rate increases for employees with less than 1 year tenure' },
    },
  ];

  for (const rule of meritRules) {
    await prisma.rule.upsert({
      where: { id: rule.id },
      update: {},
      create: { ...rule, ruleSetId: meritRuleSet.id, enabled: true },
    });
  }

  const bonusRuleSet = await prisma.ruleSet.upsert({
    where: { id: 'seed-ruleset-bonus' },
    update: {},
    create: {
      id: 'seed-ruleset-bonus',
      tenantId: tenant.id,
      name: 'Bonus Eligibility Rules',
      description: 'Rules governing quarterly bonus eligibility and calculations.',
      version: 1,
      status: RuleSetStatus.ACTIVE,
      effectiveDate: new Date('2025-10-01'),
      schema: { type: 'bonus', version: '1.0' },
    },
  });

  const bonusRules = [
    {
      id: 'seed-rule-bonus-eligibility',
      name: 'Bonus Eligibility',
      ruleType: RuleType.ELIGIBILITY,
      priority: 1,
      conditions: { tenureMonths: { gte: 6 }, performanceRating: { gte: 'meets_expectations' } },
      actions: { eligible: true },
      metadata: { description: 'Must have 6+ months tenure and meet expectations' },
    },
    {
      id: 'seed-rule-bonus-cap',
      name: 'Bonus Cap',
      ruleType: RuleType.CAP,
      priority: 2,
      conditions: { maxBonusPct: 20 },
      actions: { capAt: 20, escalateAbove: 15 },
      metadata: { description: 'Bonus capped at 20%, escalation required above 15%' },
    },
  ];

  for (const rule of bonusRules) {
    await prisma.rule.upsert({
      where: { id: rule.id },
      update: {},
      create: { ...rule, ruleSetId: bonusRuleSet.id, enabled: true },
    });
  }

  // Promotion Eligibility Rules (3rd rule set)
  const promoRuleSet = await prisma.ruleSet.upsert({
    where: { id: 'seed-ruleset-promo' },
    update: {},
    create: {
      id: 'seed-ruleset-promo',
      tenantId: tenant.id,
      name: 'Promotion Eligibility Rules',
      description:
        'Rules governing promotion eligibility based on tenure, performance, and budget.',
      version: 1,
      status: RuleSetStatus.ACTIVE,
      effectiveDate: new Date('2026-04-01'),
      schema: { type: 'promotion', version: '1.0' },
    },
  });

  const promoRules = [
    {
      id: 'seed-rule-promo-tenure',
      name: 'Tenure Requirement',
      ruleType: RuleType.ELIGIBILITY,
      priority: 1,
      conditions: { tenureMonths: { gte: 18 } },
      actions: { eligible: true },
      metadata: { description: 'Must have at least 18 months tenure to be eligible for promotion' },
    },
    {
      id: 'seed-rule-promo-performance',
      name: 'Performance Gate',
      ruleType: RuleType.ELIGIBILITY,
      priority: 2,
      conditions: {
        performanceRating: { gte: 'exceeds_expectations' },
        consecutiveHighRatings: { gte: 2 },
      },
      actions: { eligible: true },
      metadata: {
        description: 'Must have exceeded expectations for 2+ consecutive review periods',
      },
    },
    {
      id: 'seed-rule-promo-budget',
      name: 'Budget Check',
      ruleType: RuleType.CAP,
      priority: 3,
      conditions: { departmentBudgetRemaining: { gte: 'promotionCost' } },
      actions: { capAt: 'departmentBudget', escalateIfExceeds: true },
      metadata: { description: 'Promotion cost must fit within department budget allocation' },
    },
  ];

  for (const rule of promoRules) {
    await prisma.rule.upsert({
      where: { id: rule.id },
      update: {},
      create: { ...rule, ruleSetId: promoRuleSet.id, enabled: true },
    });
  }
  console.log(
    `  ✅ Rule Sets: ${meritRuleSet.name} (3), ${bonusRuleSet.name} (2), ${promoRuleSet.name} (3)`,
  );

  // ─────────────────────────────────────────────────────────────
  // 9. Benefit Plans with Enrollments
  // ─────────────────────────────────────────────────────────────
  const healthPlan = await prisma.benefitPlan.upsert({
    where: { id: 'seed-plan-health-ppo' },
    update: {},
    create: {
      id: 'seed-plan-health-ppo',
      tenantId: tenant.id,
      planType: BenefitPlanType.MEDICAL,
      name: 'Health PPO',
      carrier: 'Blue Cross Blue Shield',
      description: 'Preferred Provider Organization with nationwide coverage.',
      network: 'PPO National',
      premiums: { EMPLOYEE: 150, EMPLOYEE_SPOUSE: 350, EMPLOYEE_CHILDREN: 300, FAMILY: 500 },
      deductibles: { individual: 500, family: 1500 },
      outOfPocketMax: { individual: 3000, family: 6000 },
      copays: { primaryCare: 25, specialist: 50, urgentCare: 75, emergency: 250 },
      coverageDetails: { preventiveCare: '100%', inNetwork: '80%', outOfNetwork: '60%' },
      effectiveDate: new Date('2026-01-01'),
      isActive: true,
    },
  });

  const dentalPlan = await prisma.benefitPlan.upsert({
    where: { id: 'seed-plan-dental' },
    update: {},
    create: {
      id: 'seed-plan-dental',
      tenantId: tenant.id,
      planType: BenefitPlanType.DENTAL,
      name: 'Dental Basic',
      carrier: 'Delta Dental',
      description: 'Basic dental coverage including preventive and basic restorative.',
      network: 'Delta PPO',
      premiums: { EMPLOYEE: 30, EMPLOYEE_SPOUSE: 60, EMPLOYEE_CHILDREN: 55, FAMILY: 90 },
      deductibles: { individual: 50, family: 150 },
      outOfPocketMax: { individual: 1500, family: 3000 },
      copays: { cleaning: 0, filling: 20, crown: 50 },
      coverageDetails: {
        preventive: '100%',
        basic: '80%',
        major: '50%',
        orthodontia: '50% child only',
      },
      effectiveDate: new Date('2026-01-01'),
      isActive: true,
    },
  });

  const visionPlan = await prisma.benefitPlan.upsert({
    where: { id: 'seed-plan-vision' },
    update: {},
    create: {
      id: 'seed-plan-vision',
      tenantId: tenant.id,
      planType: BenefitPlanType.VISION,
      name: 'Vision Plus',
      carrier: 'VSP',
      description: 'Comprehensive vision coverage with annual exam and lens allowance.',
      network: 'VSP Choice',
      premiums: { EMPLOYEE: 15, EMPLOYEE_SPOUSE: 30, EMPLOYEE_CHILDREN: 25, FAMILY: 40 },
      deductibles: { individual: 0, family: 0 },
      outOfPocketMax: { individual: 200, family: 400 },
      copays: { exam: 10, lenses: 25, frames: 0 },
      coverageDetails: {
        examFrequency: 'annual',
        lensAllowance: 150,
        frameAllowance: 200,
        contactAllowance: 150,
      },
      effectiveDate: new Date('2026-01-01'),
      isActive: true,
    },
  });
  // Life Insurance plan
  const lifePlan = await prisma.benefitPlan.upsert({
    where: { id: 'seed-plan-life' },
    update: {},
    create: {
      id: 'seed-plan-life',
      tenantId: tenant.id,
      planType: BenefitPlanType.LIFE,
      name: 'Group Life Insurance',
      carrier: 'MetLife',
      description: 'Group term life insurance with coverage from $50K to $500K.',
      network: null,
      premiums: { EMPLOYEE: 25, EMPLOYEE_SPOUSE: 45, EMPLOYEE_CHILDREN: 35, FAMILY: 65 },
      deductibles: { individual: 0, family: 0 },
      outOfPocketMax: { individual: 0, family: 0 },
      copays: {},
      coverageDetails: {
        minCoverage: 50000,
        maxCoverage: 500000,
        defaultMultiplier: '1x salary',
        adAndD: true,
      },
      effectiveDate: new Date('2026-01-01'),
      isActive: true,
    },
  });

  // Short-Term Disability plan
  const disabilityPlan = await prisma.benefitPlan.upsert({
    where: { id: 'seed-plan-disability' },
    update: {},
    create: {
      id: 'seed-plan-disability',
      tenantId: tenant.id,
      planType: BenefitPlanType.DISABILITY,
      name: 'Short-Term Disability',
      carrier: 'Unum',
      description: 'Short-term disability coverage at 60% salary replacement for up to 26 weeks.',
      network: null,
      premiums: { EMPLOYEE: 18, EMPLOYEE_SPOUSE: 18, EMPLOYEE_CHILDREN: 18, FAMILY: 18 },
      deductibles: { individual: 0, family: 0 },
      outOfPocketMax: { individual: 0, family: 0 },
      copays: {},
      coverageDetails: {
        replacementPct: 60,
        maxWeeklyBenefit: 2500,
        eliminationPeriod: '7 days',
        maxDuration: '26 weeks',
      },
      effectiveDate: new Date('2026-01-01'),
      isActive: true,
    },
  });
  console.log(`  ✅ Benefit Plans: Health PPO, Dental, Vision, Life, Disability`);

  // Benefit Enrollments — all 50 in Health+Dental, ~35 Vision, ~40 Life, ~25 Disability
  const tierCycle: BenefitTier[] = [
    BenefitTier.FAMILY,
    BenefitTier.EMPLOYEE_SPOUSE,
    BenefitTier.EMPLOYEE,
    BenefitTier.EMPLOYEE_CHILDREN,
    BenefitTier.EMPLOYEE,
    BenefitTier.FAMILY,
    BenefitTier.EMPLOYEE_SPOUSE,
    BenefitTier.EMPLOYEE,
    BenefitTier.EMPLOYEE,
    BenefitTier.FAMILY,
  ];
  const premiumMap: Record<string, Record<string, number>> = {
    [healthPlan.id]: { EMPLOYEE: 150, EMPLOYEE_SPOUSE: 350, EMPLOYEE_CHILDREN: 300, FAMILY: 500 },
    [dentalPlan.id]: { EMPLOYEE: 30, EMPLOYEE_SPOUSE: 60, EMPLOYEE_CHILDREN: 55, FAMILY: 90 },
    [visionPlan.id]: { EMPLOYEE: 15, EMPLOYEE_SPOUSE: 30, EMPLOYEE_CHILDREN: 25, FAMILY: 40 },
    [lifePlan.id]: { EMPLOYEE: 25, EMPLOYEE_SPOUSE: 45, EMPLOYEE_CHILDREN: 35, FAMILY: 65 },
    [disabilityPlan.id]: { EMPLOYEE: 18, EMPLOYEE_SPOUSE: 18, EMPLOYEE_CHILDREN: 18, FAMILY: 18 },
  };

  // Define which plans each employee gets
  const planAssignments = [
    { plan: healthPlan, count: 50 }, // all
    { plan: dentalPlan, count: 50 }, // all
    { plan: visionPlan, count: 35 }, // first 35
    { plan: lifePlan, count: 40 }, // first 40
    { plan: disabilityPlan, count: 25 }, // first 25
  ];

  let enrollmentCount = 0;
  for (const { plan, count } of planAssignments) {
    for (let i = 0; i < Math.min(count, createdEmployees.length); i++) {
      const emp = createdEmployees[i]!;
      const tier = tierCycle[i % tierCycle.length]!;
      const premium = premiumMap[plan.id]![tier] ?? 0;
      const enrollId = `seed-enroll-${emp.code}-${plan.id.replace('seed-plan-', '')}`;
      await prisma.benefitEnrollment.upsert({
        where: { id: enrollId },
        update: {},
        create: {
          id: enrollId,
          tenantId: tenant.id,
          employeeId: emp.id,
          planId: plan.id,
          tier,
          status: EnrollmentStatus.ACTIVE,
          effectiveDate: new Date('2026-01-01'),
          employeePremium: premium,
          employerPremium: Math.round(premium * 0.7),
          electedAt: new Date('2025-11-15'),
          metadata: { enrollmentPeriod: '2026 Open Enrollment' },
        },
      });
      enrollmentCount++;
    }
  }
  console.log(`  ✅ Benefit Enrollments: ${enrollmentCount} created`);

  // ─────────────────────────────────────────────────────────────
  // 9b. Benefit Dependents (~30 for ~15 employees)
  // ─────────────────────────────────────────────────────────────
  const dependentsData = [
    {
      id: 'seed-dep-1',
      empCode: 'ENG-001',
      first: 'Anita',
      last: 'Kumar',
      rel: DependentRelationship.SPOUSE,
      dob: '1988-05-12',
    },
    {
      id: 'seed-dep-2',
      empCode: 'ENG-001',
      first: 'Rohan',
      last: 'Kumar',
      rel: DependentRelationship.CHILD,
      dob: '2015-09-03',
    },
    {
      id: 'seed-dep-3',
      empCode: 'ENG-001',
      first: 'Siya',
      last: 'Kumar',
      rel: DependentRelationship.CHILD,
      dob: '2018-02-14',
    },
    {
      id: 'seed-dep-4',
      empCode: 'ENG-004',
      first: 'Vikram',
      last: 'Patel',
      rel: DependentRelationship.SPOUSE,
      dob: '1991-11-20',
    },
    {
      id: 'seed-dep-5',
      empCode: 'ENG-004',
      first: 'Aarav',
      last: 'Patel',
      rel: DependentRelationship.CHILD,
      dob: '2019-07-08',
    },
    {
      id: 'seed-dep-6',
      empCode: 'SAL-001',
      first: 'Catherine',
      last: 'Brooks',
      rel: DependentRelationship.SPOUSE,
      dob: '1986-03-25',
    },
    {
      id: 'seed-dep-7',
      empCode: 'SAL-001',
      first: 'Ethan',
      last: 'Brooks',
      rel: DependentRelationship.CHILD,
      dob: '2014-12-01',
    },
    {
      id: 'seed-dep-8',
      empCode: 'SAL-002',
      first: 'David',
      last: 'Lee',
      rel: DependentRelationship.SPOUSE,
      dob: '1989-08-15',
    },
    {
      id: 'seed-dep-9',
      empCode: 'HR-001',
      first: 'Robert',
      last: 'Williams',
      rel: DependentRelationship.SPOUSE,
      dob: '1985-01-30',
    },
    {
      id: 'seed-dep-10',
      empCode: 'HR-001',
      first: 'Maya',
      last: 'Williams',
      rel: DependentRelationship.CHILD,
      dob: '2016-06-22',
    },
    {
      id: 'seed-dep-11',
      empCode: 'FIN-001',
      first: 'James',
      last: 'Morgan',
      rel: DependentRelationship.SPOUSE,
      dob: '1984-10-05',
    },
    {
      id: 'seed-dep-12',
      empCode: 'FIN-001',
      first: 'Sophia',
      last: 'Morgan',
      rel: DependentRelationship.CHILD,
      dob: '2013-04-18',
    },
    {
      id: 'seed-dep-13',
      empCode: 'FIN-001',
      first: 'Oliver',
      last: 'Morgan',
      rel: DependentRelationship.CHILD,
      dob: '2016-11-30',
    },
    {
      id: 'seed-dep-14',
      empCode: 'MKT-001',
      first: 'Mark',
      last: 'Foster',
      rel: DependentRelationship.SPOUSE,
      dob: '1987-07-14',
    },
    {
      id: 'seed-dep-15',
      empCode: 'PRD-001',
      first: 'Steven',
      last: 'Mitchell',
      rel: DependentRelationship.SPOUSE,
      dob: '1986-09-22',
    },
    {
      id: 'seed-dep-16',
      empCode: 'PRD-001',
      first: 'Lily',
      last: 'Mitchell',
      rel: DependentRelationship.CHILD,
      dob: '2017-03-10',
    },
    {
      id: 'seed-dep-17',
      empCode: 'LEG-001',
      first: 'Michael',
      last: 'Adams',
      rel: DependentRelationship.SPOUSE,
      dob: '1983-12-08',
    },
    {
      id: 'seed-dep-18',
      empCode: 'ENG-003',
      first: 'Tanya',
      last: 'Johnson',
      rel: DependentRelationship.SPOUSE,
      dob: '1990-04-17',
    },
    {
      id: 'seed-dep-19',
      empCode: 'ENG-003',
      first: 'Miles',
      last: 'Johnson',
      rel: DependentRelationship.CHILD,
      dob: '2020-01-25',
    },
    {
      id: 'seed-dep-20',
      empCode: 'SAL-003',
      first: 'Karen',
      last: 'Thompson',
      rel: DependentRelationship.SPOUSE,
      dob: '1988-06-30',
    },
    {
      id: 'seed-dep-21',
      empCode: 'FIN-002',
      first: 'Susan',
      last: 'Hall',
      rel: DependentRelationship.SPOUSE,
      dob: '1987-02-14',
    },
    {
      id: 'seed-dep-22',
      empCode: 'FIN-002',
      first: 'Nathan',
      last: 'Hall',
      rel: DependentRelationship.CHILD,
      dob: '2015-08-20',
    },
    {
      id: 'seed-dep-23',
      empCode: 'ENG-005',
      first: 'Emily',
      last: 'Wilson',
      rel: DependentRelationship.SPOUSE,
      dob: '1991-10-03',
    },
    {
      id: 'seed-dep-24',
      empCode: 'ENG-005',
      first: 'Jack',
      last: 'Wilson',
      rel: DependentRelationship.CHILD,
      dob: '2021-05-15',
    },
    {
      id: 'seed-dep-25',
      empCode: 'HR-003',
      first: 'Carlos',
      last: 'Santos',
      rel: DependentRelationship.SPOUSE,
      dob: '1990-12-01',
    },
    {
      id: 'seed-dep-26',
      empCode: 'MKT-002',
      first: 'Linda',
      last: 'Murphy',
      rel: DependentRelationship.SPOUSE,
      dob: '1989-03-28',
    },
    {
      id: 'seed-dep-27',
      empCode: 'MKT-002',
      first: 'Sean',
      last: 'Murphy',
      rel: DependentRelationship.CHILD,
      dob: '2018-09-12',
    },
    {
      id: 'seed-dep-28',
      empCode: 'PRD-002',
      first: 'Jessica',
      last: 'Turner',
      rel: DependentRelationship.SPOUSE,
      dob: '1990-07-19',
    },
    {
      id: 'seed-dep-29',
      empCode: 'LEG-002',
      first: 'Margaret',
      last: 'Baker',
      rel: DependentRelationship.SPOUSE,
      dob: '1988-11-05',
    },
    {
      id: 'seed-dep-30',
      empCode: 'SAL-005',
      first: 'Maria',
      last: 'Garcia',
      rel: DependentRelationship.DOMESTIC_PARTNER,
      dob: '1992-01-20',
    },
  ];

  for (const dep of dependentsData) {
    const emp = createdEmployees.find((e) => e.code === dep.empCode);
    if (!emp) continue;
    await prisma.benefitDependent.upsert({
      where: { id: dep.id },
      update: {},
      create: {
        id: dep.id,
        employeeId: emp.id,
        firstName: dep.first,
        lastName: dep.last,
        relationship: dep.rel,
        dateOfBirth: new Date(dep.dob),
      },
    });
  }
  console.log(`  ✅ Benefit Dependents: ${dependentsData.length} created`);

  // ─────────────────────────────────────────────────────────────
  // 9c. Enrollment Window
  // ─────────────────────────────────────────────────────────────
  await prisma.enrollmentWindow.upsert({
    where: { id: 'seed-enrollment-window-2026' },
    update: {},
    create: {
      id: 'seed-enrollment-window-2026',
      tenantId: tenant.id,
      name: '2026 Open Enrollment',
      planYear: 2026,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-31'),
      status: EnrollmentWindowStatus.OPEN,
      metadata: { description: 'Annual open enrollment for plan year 2026' },
    },
  });
  console.log('  ✅ Enrollment Window: 2026 Open Enrollment');

  // ─────────────────────────────────────────────────────────────
  // 9d. Life Events (4)
  // ─────────────────────────────────────────────────────────────
  const lifeEventsData = [
    {
      id: 'seed-life-event-1',
      empCode: 'ENG-006',
      type: LifeEventType.MARRIAGE,
      date: '2026-01-15',
      desc: 'Marriage — adding spouse to benefits',
    },
    {
      id: 'seed-life-event-2',
      empCode: 'SAL-004',
      type: LifeEventType.BIRTH,
      date: '2026-02-01',
      desc: 'Birth of child — adding dependent',
    },
    {
      id: 'seed-life-event-3',
      empCode: 'HR-003',
      type: LifeEventType.ADOPTION,
      date: '2025-12-10',
      desc: 'Adoption finalized — adding child dependent',
    },
    {
      id: 'seed-life-event-4',
      empCode: 'FIN-005',
      type: LifeEventType.LOSS_OF_COVERAGE,
      date: '2026-01-20',
      desc: 'Spouse lost employer coverage — qualifying event',
    },
  ];

  for (const le of lifeEventsData) {
    const emp = createdEmployees.find((e) => e.code === le.empCode);
    if (!emp) continue;
    await prisma.lifeEvent.upsert({
      where: { id: le.id },
      update: {},
      create: {
        id: le.id,
        tenantId: tenant.id,
        employeeId: emp.id,
        eventType: le.type,
        eventDate: new Date(le.date),
        qualifyingDate: new Date(le.date),
        description: le.desc,
        status: le.id === 'seed-life-event-3' ? 'APPROVED' : 'PENDING',
      },
    });
  }
  console.log('  ✅ Life Events: 4 created');

  // ─────────────────────────────────────────────────────────────
  // 10. Payroll Runs with Line Items (3 months)
  // ─────────────────────────────────────────────────────────────
  const payrollPeriods = [
    { id: 'seed-payroll-jan-2026', period: '2026-01', status: PayrollStatus.FINALIZED },
    { id: 'seed-payroll-feb-2026', period: '2026-02', status: PayrollStatus.REVIEW },
    { id: 'seed-payroll-mar-2026', period: '2026-03', status: PayrollStatus.DRAFT },
  ];

  for (const pr of payrollPeriods) {
    let totalGross = 0;
    let totalNet = 0;

    const payrollRun = await prisma.payrollRun.upsert({
      where: { id: pr.id },
      update: {},
      create: {
        id: pr.id,
        tenantId: tenant.id,
        period: pr.period,
        status: pr.status,
        totalGross: 0,
        totalNet: 0,
        employeeCount: createdEmployees.length,
      },
    });

    for (let i = 0; i < createdEmployees.length; i++) {
      const emp = createdEmployees[i]!;
      const monthlySalary = Math.round(emp.salary / 12);
      const tax = Math.round(monthlySalary * 0.28);
      const benefits = Math.round(monthlySalary * 0.05);
      const netPay = monthlySalary - tax - benefits;
      totalGross += monthlySalary;
      totalNet += netPay;

      const components = [
        { component: 'BASE_SALARY', amount: monthlySalary, previous: monthlySalary, delta: 0 },
        { component: 'FEDERAL_TAX', amount: -tax, previous: -tax, delta: 0 },
        { component: 'BENEFITS_DEDUCTION', amount: -benefits, previous: -benefits, delta: 0 },
        { component: 'NET_PAY', amount: netPay, previous: netPay, delta: 0 },
      ];

      for (const comp of components) {
        const lineId = `seed-pli-${pr.period}-${emp.code}-${comp.component}`;
        await prisma.payrollLineItem.upsert({
          where: { id: lineId },
          update: {},
          create: {
            id: lineId,
            payrollRunId: payrollRun.id,
            employeeId: emp.id,
            component: comp.component,
            amount: comp.amount,
            previousAmount: comp.previous,
            delta: comp.delta,
          },
        });
      }
    }

    // Update totals
    await prisma.payrollRun.update({
      where: { id: pr.id },
      data: { totalGross, totalNet },
    });
  }
  console.log('  ✅ Payroll Runs: Jan (finalized), Feb (review), Mar (draft)');

  // ─────────────────────────────────────────────────────────────
  // 10b. Payroll Anomalies (5) with AI Explanations
  // ─────────────────────────────────────────────────────────────
  const anomaliesData = [
    {
      id: 'seed-anomaly-1',
      runId: 'seed-payroll-feb-2026',
      empIdx: 2,
      type: AnomalyType.SPIKE,
      severity: AnomalySeverity.MEDIUM,
      details: {
        description: 'Base salary component increased 15% vs prior period',
        previousAmount: 7500,
        currentAmount: 8625,
        changePct: 15,
      },
    },
    {
      id: 'seed-anomaly-2',
      runId: 'seed-payroll-feb-2026',
      empIdx: 10,
      type: AnomalyType.NEGATIVE_NET,
      severity: AnomalySeverity.CRITICAL,
      details: {
        description: 'Net pay is negative after deductions',
        grossPay: 8333,
        totalDeductions: 9100,
        netPay: -767,
      },
    },
    {
      id: 'seed-anomaly-3',
      runId: 'seed-payroll-feb-2026',
      empIdx: 20,
      type: AnomalyType.DROP,
      severity: AnomalySeverity.HIGH,
      details: {
        description: 'Base salary dropped 25% vs prior period',
        previousAmount: 12500,
        currentAmount: 9375,
        changePct: -25,
      },
    },
    {
      id: 'seed-anomaly-4',
      runId: 'seed-payroll-mar-2026',
      empIdx: 5,
      type: AnomalyType.UNUSUAL_DEDUCTION,
      severity: AnomalySeverity.MEDIUM,
      details: {
        description: 'One-time deduction of $5,000 for relocation repayment',
        component: 'RELOCATION_REPAYMENT',
        amount: 5000,
      },
    },
    {
      id: 'seed-anomaly-5',
      runId: 'seed-payroll-mar-2026',
      empIdx: 35,
      type: AnomalyType.MISSING_COMPONENT,
      severity: AnomalySeverity.LOW,
      details: {
        description: 'Benefits deduction component missing from March payroll',
        missingComponent: 'BENEFITS_DEDUCTION',
      },
    },
  ];

  for (const a of anomaliesData) {
    await prisma.payrollAnomaly.upsert({
      where: { id: a.id },
      update: {},
      create: {
        id: a.id,
        payrollRunId: a.runId,
        employeeId: createdEmployees[a.empIdx]!.id,
        anomalyType: a.type,
        severity: a.severity,
        details: a.details,
        resolved: a.id === 'seed-anomaly-5',
      },
    });
  }

  // AI-generated anomaly explanations
  const explanationsData = [
    {
      id: 'seed-anomaly-expl-1',
      anomalyId: 'seed-anomaly-1',
      explanation:
        'The salary increase corresponds to a mid-cycle merit adjustment approved on 2026-01-28.',
      rootCause: 'Approved merit increase of 15% applied retroactively to February payroll.',
      contributingFactors: [
        'Merit cycle adjustment',
        'Manager approval on file',
        'Within department budget',
      ],
      recommendedAction: 'review',
      confidence: 0.92,
      reasoning:
        'The increase aligns with the active merit cycle and has manager approval in the system.',
    },
    {
      id: 'seed-anomaly-expl-2',
      anomalyId: 'seed-anomaly-2',
      explanation:
        'Employee has multiple garnishments and a benefits tier upgrade that pushed deductions above gross.',
      rootCause: 'Overlapping garnishment orders combined with FAMILY tier benefits election.',
      contributingFactors: [
        'Court-ordered garnishment $2,500/mo',
        'FAMILY tier benefits premium $500/mo',
        'Tax withholding increase',
      ],
      recommendedAction: 'escalate',
      confidence: 0.88,
      reasoning:
        'Multiple deduction sources combined exceed monthly gross. Requires payroll coordinator review.',
    },
    {
      id: 'seed-anomaly-expl-3',
      anomalyId: 'seed-anomaly-3',
      explanation: 'Employee transitioned from full-time to part-time (60%) effective February 1.',
      rootCause: 'Employment status change from FT to PT reduced base salary proportionally.',
      contributingFactors: [
        'HR status change record dated 2026-01-15',
        'Part-time agreement at 60%',
        'Benefits eligibility maintained',
      ],
      recommendedAction: 'flag',
      confidence: 0.95,
      reasoning:
        'The 25% drop matches the 60% part-time conversion. HR records confirm the transition.',
    },
    {
      id: 'seed-anomaly-expl-4',
      anomalyId: 'seed-anomaly-4',
      explanation:
        'One-time relocation repayment deduction per signed agreement for early departure from relocated role.',
      rootCause:
        'Employee transferred back within 12 months, triggering relocation clawback clause.',
      contributingFactors: [
        'Relocation agreement signed 2025-04-01',
        'Transfer request approved 2026-02-15',
        'Pro-rated repayment of $5,000',
      ],
      recommendedAction: 'flag',
      confidence: 0.91,
      reasoning:
        'Deduction matches the pro-rated relocation repayment per the signed agreement terms.',
    },
    {
      id: 'seed-anomaly-expl-5',
      anomalyId: 'seed-anomaly-5',
      explanation:
        'Benefits deduction was omitted from March draft payroll due to a timing issue with plan renewal.',
      rootCause:
        'Benefits plan renewal processing delayed; deductions not yet populated for March.',
      contributingFactors: [
        'Annual plan renewal in progress',
        'Carrier file not yet received',
        'Draft status allows corrections',
      ],
      recommendedAction: 'flag',
      confidence: 0.85,
      reasoning:
        'March payroll is in DRAFT status. Benefits deductions will be populated once carrier confirms renewals.',
    },
  ];

  for (const expl of explanationsData) {
    await prisma.anomalyExplanation.upsert({
      where: { id: expl.id },
      update: {},
      create: expl,
    });
  }
  console.log('  ✅ Payroll Anomalies: 5 flagged with AI explanations');

  // ─────────────────────────────────────────────────────────────
  // 11. Integration Connectors, Field Mappings, Sync Jobs
  // ─────────────────────────────────────────────────────────────
  const connectorsData = [
    {
      id: 'seed-connector-workday',
      name: 'Workday HRIS',
      type: ConnectorType.HRIS,
      status: ConnectorStatus.ACTIVE,
      direction: SyncDirection.INBOUND,
      schedule: SyncSchedule.DAILY,
      config: {
        baseUrl: 'https://wd5-impl.workday.com/acme',
        apiVersion: 'v40.1',
        tenantAlias: 'acme_impl',
      },
      healthStatus: 'healthy',
      lastSyncAt: new Date('2026-02-22T06:00:00Z'),
      lastHealthCheck: new Date('2026-02-23T00:00:00Z'),
    },
    {
      id: 'seed-connector-adp',
      name: 'ADP Payroll',
      type: ConnectorType.PAYROLL,
      status: ConnectorStatus.ACTIVE,
      direction: SyncDirection.BIDIRECTIONAL,
      schedule: SyncSchedule.DAILY,
      config: {
        baseUrl: 'https://api.adp.com/hr/v2',
        clientId: 'acme-prod-client',
        environment: 'production',
      },
      healthStatus: 'degraded',
      lastSyncAt: new Date('2026-02-21T06:00:00Z'),
      lastHealthCheck: new Date('2026-02-23T00:00:00Z'),
    },
    {
      id: 'seed-connector-bamboo',
      name: 'BambooHR',
      type: ConnectorType.HRIS,
      status: ConnectorStatus.INACTIVE,
      direction: SyncDirection.INBOUND,
      schedule: SyncSchedule.MANUAL,
      config: { baseUrl: 'https://api.bamboohr.com/api/gateway.php/acme', apiVersion: 'v1' },
      healthStatus: 'offline',
      lastSyncAt: new Date('2025-12-15T06:00:00Z'),
      lastHealthCheck: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  for (const c of connectorsData) {
    await prisma.integrationConnector.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        tenantId: tenant.id,
        name: c.name,
        connectorType: c.type,
        status: c.status,
        syncDirection: c.direction,
        syncSchedule: c.schedule,
        config: c.config,
        conflictStrategy: ConflictStrategy.LAST_WRITE_WINS,
        healthStatus: c.healthStatus,
        lastSyncAt: c.lastSyncAt,
        lastHealthCheck: c.lastHealthCheck,
        metadata: { setupBy: 'admin@acme.com' },
      },
    });
  }

  // Field Mappings (for Workday and ADP)
  const fieldMappingsData = [
    {
      id: 'seed-fm-wd-1',
      connId: 'seed-connector-workday',
      src: 'Worker.Employee_ID',
      tgt: 'employeeCode',
      type: 'direct',
      required: true,
    },
    {
      id: 'seed-fm-wd-2',
      connId: 'seed-connector-workday',
      src: 'Worker.Legal_Name.First_Name',
      tgt: 'firstName',
      type: 'direct',
      required: true,
    },
    {
      id: 'seed-fm-wd-3',
      connId: 'seed-connector-workday',
      src: 'Worker.Legal_Name.Last_Name',
      tgt: 'lastName',
      type: 'direct',
      required: true,
    },
    {
      id: 'seed-fm-wd-4',
      connId: 'seed-connector-workday',
      src: 'Worker.Email_Address',
      tgt: 'email',
      type: 'lowercase',
      required: true,
    },
    {
      id: 'seed-fm-wd-5',
      connId: 'seed-connector-workday',
      src: 'Worker.Compensation.Base_Pay',
      tgt: 'baseSalary',
      type: 'decimal',
      required: false,
    },
    {
      id: 'seed-fm-adp-1',
      connId: 'seed-connector-adp',
      src: 'workers.associateOID',
      tgt: 'employeeCode',
      type: 'direct',
      required: true,
    },
    {
      id: 'seed-fm-adp-2',
      connId: 'seed-connector-adp',
      src: 'workers.person.legalName.givenName',
      tgt: 'firstName',
      type: 'direct',
      required: true,
    },
    {
      id: 'seed-fm-adp-3',
      connId: 'seed-connector-adp',
      src: 'workers.person.legalName.familyName1',
      tgt: 'lastName',
      type: 'direct',
      required: true,
    },
    {
      id: 'seed-fm-adp-4',
      connId: 'seed-connector-adp',
      src: 'workers.businessCommunication.emails',
      tgt: 'email',
      type: 'extract_primary',
      required: true,
    },
    {
      id: 'seed-fm-adp-5',
      connId: 'seed-connector-adp',
      src: 'workers.compensation.baseRemuneration',
      tgt: 'baseSalary',
      type: 'decimal',
      required: false,
    },
  ];

  for (const fm of fieldMappingsData) {
    await prisma.fieldMapping.upsert({
      where: { id: fm.id },
      update: {},
      create: {
        id: fm.id,
        connectorId: fm.connId,
        tenantId: tenant.id,
        sourceField: fm.src,
        targetField: fm.tgt,
        transformType: fm.type,
        isRequired: fm.required,
        enabled: true,
      },
    });
  }

  // Sync Jobs (4 total)
  const syncJobsData = [
    {
      id: 'seed-sync-wd-1',
      connId: 'seed-connector-workday',
      entity: 'employees',
      status: SyncJobStatus.COMPLETED,
      total: 50,
      processed: 50,
      failed: 0,
      skipped: 0,
      startedAt: new Date('2026-02-22T06:00:00Z'),
      completedAt: new Date('2026-02-22T06:03:22Z'),
    },
    {
      id: 'seed-sync-wd-2',
      connId: 'seed-connector-workday',
      entity: 'compensation',
      status: SyncJobStatus.COMPLETED,
      total: 50,
      processed: 48,
      failed: 0,
      skipped: 2,
      startedAt: new Date('2026-02-22T06:04:00Z'),
      completedAt: new Date('2026-02-22T06:05:45Z'),
    },
    {
      id: 'seed-sync-adp-1',
      connId: 'seed-connector-adp',
      entity: 'payroll',
      status: SyncJobStatus.COMPLETED,
      total: 50,
      processed: 50,
      failed: 0,
      skipped: 0,
      startedAt: new Date('2026-02-21T06:00:00Z'),
      completedAt: new Date('2026-02-21T06:02:10Z'),
    },
    {
      id: 'seed-sync-adp-2',
      connId: 'seed-connector-adp',
      entity: 'deductions',
      status: SyncJobStatus.FAILED,
      total: 50,
      processed: 32,
      failed: 18,
      skipped: 0,
      startedAt: new Date('2026-02-21T06:03:00Z'),
      completedAt: new Date('2026-02-21T06:04:55Z'),
      errorMessage:
        'API rate limit exceeded after 32 records. Retry scheduled for next sync window.',
    },
  ];

  for (const sj of syncJobsData) {
    await prisma.syncJob.upsert({
      where: { id: sj.id },
      update: {},
      create: {
        id: sj.id,
        connectorId: sj.connId,
        tenantId: tenant.id,
        direction: SyncDirection.INBOUND,
        entityType: sj.entity,
        status: sj.status,
        totalRecords: sj.total,
        processedRecords: sj.processed,
        failedRecords: sj.failed,
        skippedRecords: sj.skipped,
        startedAt: sj.startedAt,
        completedAt: sj.completedAt,
        errorMessage: sj.errorMessage ?? null,
      },
    });
  }
  console.log('  ✅ Integration Hub: 3 connectors, 10 field mappings, 4 sync jobs');

  // ─────────────────────────────────────────────────────────────
  // 12. Compliance Scan with Findings (5)
  // ─────────────────────────────────────────────────────────────
  const complianceScan = await prisma.complianceScan.upsert({
    where: { id: 'seed-compliance-scan-1' },
    update: {},
    create: {
      id: 'seed-compliance-scan-1',
      tenantId: tenant.id,
      userId: admin.id,
      status: ComplianceScanStatus.COMPLETED,
      overallScore: 82,
      riskSummary: {
        critical: 0,
        warning: 3,
        info: 2,
        totalFindings: 5,
        topRisks: [
          'Pay equity gap in Engineering',
          'Missing overtime classification',
          'Remote work policy gaps',
        ],
      },
      scanConfig: {
        scope: 'full',
        includePayEquity: true,
        includeFLSA: true,
        includeBenefits: true,
      },
      startedAt: new Date('2026-02-10T09:00:00Z'),
      completedAt: new Date('2026-02-10T09:05:00Z'),
    },
  });

  const findings = [
    {
      id: 'seed-finding-1',
      category: ComplianceFindingCategory.PAY_EQUITY,
      severity: ComplianceFindingSeverity.WARNING,
      title: 'Gender pay gap detected in Engineering',
      description:
        'Female engineers at the Mid level earn 4.2% less than male counterparts on average.',
      explanation:
        'Analysis of base salary data shows a statistically significant gap at the Mid level in Engineering.',
      remediation:
        'Review and adjust compensation for affected employees during the current merit cycle.',
      affectedScope: { department: 'Engineering', level: 'Mid', affectedCount: 4 },
      metadata: { gapPct: 4.2, confidence: 0.87 },
    },
    {
      id: 'seed-finding-2',
      category: ComplianceFindingCategory.FLSA_OVERTIME,
      severity: ComplianceFindingSeverity.WARNING,
      title: 'Missing FLSA overtime classification',
      description: 'Five Junior-level employees may be misclassified as exempt from overtime.',
      explanation:
        'Employees earning below the FLSA salary threshold should be classified as non-exempt.',
      remediation:
        'Review classification for Junior employees and update payroll records accordingly.',
      affectedScope: { level: 'Junior', affectedCount: 5 },
      metadata: { threshold: 35568, currentMinSalary: 80000 },
    },
    {
      id: 'seed-finding-3',
      category: ComplianceFindingCategory.DATA_QUALITY,
      severity: ComplianceFindingSeverity.INFO,
      title: 'Missing emergency contact information',
      description: '12 employees are missing emergency contact details in their profile.',
      explanation:
        'Emergency contact information is required by company policy and recommended by OSHA guidelines.',
      remediation:
        'Send reminder to affected employees to update their emergency contact information.',
      affectedScope: { affectedCount: 12 },
      metadata: { complianceStandard: 'OSHA' },
    },
    {
      id: 'seed-finding-4',
      category: ComplianceFindingCategory.POLICY_VIOLATION,
      severity: ComplianceFindingSeverity.WARNING,
      title: 'Remote work compensation policy gaps',
      description:
        'Employees in London and Bangalore lack location-based pay differential documentation.',
      explanation:
        'Company policy requires documented pay differentials for remote workers in different cost-of-living areas.',
      remediation: 'Document location-based pay policies for international remote workers.',
      affectedScope: { locations: ['London, UK', 'Bangalore, IN'], affectedCount: 8 },
      metadata: { policyRef: 'COMP-POL-2025-003' },
    },
    {
      id: 'seed-finding-5',
      category: ComplianceFindingCategory.BENEFITS_ELIGIBILITY,
      severity: ComplianceFindingSeverity.INFO,
      title: 'Benefits eligibility review needed',
      description: '3 part-time employees may be enrolled in full-time benefit plans.',
      explanation:
        'Employees working fewer than 30 hours per week may not qualify for full-time benefit tiers.',
      remediation: 'Verify part-time status and adjust benefit enrollments if necessary.',
      affectedScope: { affectedCount: 3 },
      metadata: { acaThresholdHours: 30 },
    },
  ];

  for (const finding of findings) {
    await prisma.complianceFinding.upsert({
      where: { id: finding.id },
      update: {},
      create: { ...finding, scanId: complianceScan.id, resolved: false },
    });
  }
  console.log(`  ✅ Compliance Scan: score ${complianceScan.overallScore}, 5 findings`);

  // ─────────────────────────────────────────────────────────────
  // 13. Audit Logs (20 entries over last 30 days)
  // ─────────────────────────────────────────────────────────────
  const auditActions = [
    {
      id: 'seed-audit-1',
      action: 'CREATE',
      entity: 'CompCycle',
      entityId: meritCycle.id,
      changes: { name: 'Annual Merit Review 2026', status: 'ACTIVE' },
      daysAgo: 30,
    },
    {
      id: 'seed-audit-2',
      action: 'CREATE',
      entity: 'CompCycle',
      entityId: 'seed-cycle-bonus',
      changes: { name: 'Q4 Bonus 2025', status: 'COMPLETED' },
      daysAgo: 28,
    },
    {
      id: 'seed-audit-3',
      action: 'UPDATE',
      entity: 'RuleSet',
      entityId: 'seed-ruleset-merit',
      changes: { status: { from: 'DRAFT', to: 'ACTIVE' } },
      daysAgo: 25,
    },
    {
      id: 'seed-audit-4',
      action: 'CREATE',
      entity: 'BenefitPlan',
      entityId: 'seed-plan-health-ppo',
      changes: { name: 'Health PPO' },
      daysAgo: 24,
    },
    {
      id: 'seed-audit-5',
      action: 'CREATE',
      entity: 'BenefitPlan',
      entityId: 'seed-plan-life',
      changes: { name: 'Group Life Insurance' },
      daysAgo: 24,
    },
    {
      id: 'seed-audit-6',
      action: 'BULK_IMPORT',
      entity: 'Employee',
      entityId: 'batch-2026-01',
      changes: { count: 50, source: 'Workday HRIS' },
      daysAgo: 22,
    },
    {
      id: 'seed-audit-7',
      action: 'UPDATE',
      entity: 'Employee',
      entityId: createdEmployees[5]!.id,
      changes: { department: { from: 'Sales', to: 'Engineering' } },
      daysAgo: 20,
    },
    {
      id: 'seed-audit-8',
      action: 'CREATE',
      entity: 'PayrollRun',
      entityId: 'seed-payroll-jan-2026',
      changes: { period: '2026-01', status: 'DRAFT' },
      daysAgo: 18,
    },
    {
      id: 'seed-audit-9',
      action: 'UPDATE',
      entity: 'PayrollRun',
      entityId: 'seed-payroll-jan-2026',
      changes: { status: { from: 'DRAFT', to: 'FINALIZED' } },
      daysAgo: 15,
    },
    {
      id: 'seed-audit-10',
      action: 'CREATE',
      entity: 'ComplianceScan',
      entityId: complianceScan.id,
      changes: { scope: 'full' },
      daysAgo: 13,
    },
    {
      id: 'seed-audit-11',
      action: 'CREATE',
      entity: 'Recommendation',
      entityId: 'seed-rec-1',
      changes: { type: 'MERIT_INCREASE', employeeCode: 'ENG-001' },
      daysAgo: 12,
    },
    {
      id: 'seed-audit-12',
      action: 'APPROVE',
      entity: 'Recommendation',
      entityId: 'seed-rec-1',
      changes: { status: { from: 'SUBMITTED', to: 'APPROVED' } },
      daysAgo: 10,
    },
    {
      id: 'seed-audit-13',
      action: 'CREATE',
      entity: 'IntegrationConnector',
      entityId: 'seed-connector-workday',
      changes: { name: 'Workday HRIS', type: 'HRIS' },
      daysAgo: 9,
    },
    {
      id: 'seed-audit-14',
      action: 'SYNC',
      entity: 'SyncJob',
      entityId: 'seed-sync-wd-1',
      changes: { records: 50, status: 'COMPLETED' },
      daysAgo: 8,
    },
    {
      id: 'seed-audit-15',
      action: 'UPDATE',
      entity: 'DepartmentBudget',
      entityId: 'seed-budget-eng',
      changes: { spent: { from: 0, to: 142000 } },
      daysAgo: 7,
    },
    {
      id: 'seed-audit-16',
      action: 'CREATE',
      entity: 'PayrollRun',
      entityId: 'seed-payroll-feb-2026',
      changes: { period: '2026-02' },
      daysAgo: 5,
    },
    {
      id: 'seed-audit-17',
      action: 'DETECT',
      entity: 'PayrollAnomaly',
      entityId: 'seed-anomaly-2',
      changes: { type: 'NEGATIVE_NET', severity: 'CRITICAL' },
      daysAgo: 4,
    },
    {
      id: 'seed-audit-18',
      action: 'RESOLVE',
      entity: 'PayrollAnomaly',
      entityId: 'seed-anomaly-5',
      changes: { resolved: true },
      daysAgo: 3,
    },
    {
      id: 'seed-audit-19',
      action: 'UPDATE',
      entity: 'EnrollmentWindow',
      entityId: 'seed-enrollment-window-2026',
      changes: { status: 'OPEN' },
      daysAgo: 2,
    },
    {
      id: 'seed-audit-20',
      action: 'LOGIN',
      entity: 'User',
      entityId: admin.id,
      changes: { ip: '10.0.1.42', userAgent: 'Mozilla/5.0' },
      daysAgo: 0,
    },
  ];

  for (const al of auditActions) {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - al.daysAgo);
    await prisma.auditLog.upsert({
      where: { id: al.id },
      update: {},
      create: {
        id: al.id,
        tenantId: tenant.id,
        userId: admin.id,
        action: al.action,
        entityType: al.entity,
        entityId: al.entityId,
        changes: al.changes,
        ipAddress: '10.0.1.42',
        createdAt,
      },
    });
  }
  console.log('  ✅ Audit Logs: 20 entries');

  // ─────────────────────────────────────────────────────────────
  // 14. Saved Reports (3)
  // ─────────────────────────────────────────────────────────────
  const reportsData = [
    {
      id: 'seed-report-1',
      title: 'Q1 2026 Compensation Summary',
      prompt:
        'Generate a comprehensive compensation summary for Q1 2026 including headcount, total spend, and department breakdowns.',
      status: ReportStatus.COMPLETED,
      queryType: 'compensation_summary',
      filters: { quarter: 'Q1', year: 2026 },
      results: [
        { department: 'Engineering', headcount: 12, totalComp: 2580000, avgSalary: 178333 },
      ],
      chartConfig: { type: 'bar', xAxis: 'department', yAxis: 'totalComp' },
      narrative:
        'Q1 2026 compensation analysis shows total spend of $8.2M across 50 employees. Engineering represents the largest department at 24% of headcount and 31% of total compensation spend.',
    },
    {
      id: 'seed-report-2',
      title: 'Engineering Pay Band Analysis',
      prompt:
        'Analyze pay bands for the Engineering department, showing distribution by level and identifying outliers.',
      status: ReportStatus.COMPLETED,
      queryType: 'pay_band_analysis',
      filters: { department: 'Engineering' },
      results: [{ level: 'Senior', min: 150000, max: 200000, median: 175000, count: 4 }],
      chartConfig: { type: 'boxplot', groupBy: 'level' },
      narrative:
        'Engineering pay bands are well-structured with clear progression. Senior-level salaries range from $150K-$200K. Two mid-level employees fall slightly below the target range.',
    },
    {
      id: 'seed-report-3',
      title: 'Department Budget Utilization',
      prompt: 'Show budget utilization across all departments for the current merit cycle.',
      status: ReportStatus.GENERATING,
      queryType: 'budget_utilization',
      filters: { cycleId: meritCycle.id },
      results: [],
      chartConfig: { type: 'gauge', metric: 'utilizationPct' },
      narrative: null,
    },
  ];

  for (const rpt of reportsData) {
    await prisma.savedReport.upsert({
      where: { id: rpt.id },
      update: {},
      create: {
        id: rpt.id,
        tenantId: tenant.id,
        userId: admin.id,
        title: rpt.title,
        prompt: rpt.prompt,
        status: rpt.status,
        queryType: rpt.queryType,
        filters: rpt.filters,
        results: rpt.results,
        chartConfig: rpt.chartConfig,
        narrative: rpt.narrative,
      },
    });
  }
  console.log('  ✅ Saved Reports: 3 created');

  // ─────────────────────────────────────────────────────────────
  // 15. Compensation Letters (5)
  // ─────────────────────────────────────────────────────────────
  const lettersData = [
    {
      id: 'seed-letter-1',
      empIdx: 0,
      type: LetterType.OFFER,
      status: LetterStatus.SENT,
      subject: 'Offer Letter — Senior Software Engineer',
      content:
        'Dear Priya Kumar,\n\nWe are pleased to offer you the position of Senior Software Engineer at Acme Corp. Your starting compensation package includes a base salary of $185,000, annual performance bonus target of 15%, and comprehensive benefits.\n\nPlease review and sign by February 28, 2026.',
      compData: {
        baseSalary: 185000,
        bonusTarget: '15%',
        equity: '2,000 RSUs',
        startDate: '2026-03-15',
      },
      sentAt: new Date('2026-02-15T10:00:00Z'),
    },
    {
      id: 'seed-letter-2',
      empIdx: 3,
      type: LetterType.RAISE,
      status: LetterStatus.APPROVED,
      subject: 'Merit Increase Notification — 2026 Annual Review',
      content:
        'Dear Neha Patel,\n\nAs part of our 2026 Annual Merit Review, your base salary will increase by 6.5% from $155,000 to $165,075, effective April 1, 2026.\n\nThis increase reflects your outstanding contributions to the platform architecture initiative.',
      compData: {
        previousSalary: 155000,
        newSalary: 165075,
        increasePct: 6.5,
        effectiveDate: '2026-04-01',
      },
      approvedAt: new Date('2026-02-20T14:00:00Z'),
    },
    {
      id: 'seed-letter-3',
      empIdx: 12,
      type: LetterType.BONUS,
      status: LetterStatus.REVIEW,
      subject: 'Q4 2025 Performance Bonus',
      content:
        'Dear Michael Brooks,\n\nCongratulations! Based on your performance in Q4 2025 and the company achieving 112% of revenue target, you have earned a performance bonus of $18,500.\n\nThis bonus will be included in your March 2026 payroll.',
      compData: {
        bonusAmount: 18500,
        period: 'Q4 2025',
        companyTarget: '112%',
        paymentDate: '2026-03-15',
      },
    },
    {
      id: 'seed-letter-4',
      empIdx: 8,
      type: LetterType.PROMOTION,
      status: LetterStatus.DRAFT,
      subject: 'Promotion to Senior Level — HR Department',
      content:
        'Dear Jessica Williams,\n\nWe are pleased to inform you of your promotion from Mid to Senior level in the Human Resources department, effective April 1, 2026.\n\nYour new compensation reflects a 12% increase to $134,400.',
      compData: {
        previousLevel: 'Mid',
        newLevel: 'Senior',
        previousSalary: 120000,
        newSalary: 134400,
        increasePct: 12,
      },
    },
    {
      id: 'seed-letter-5',
      empIdx: 15,
      type: LetterType.TOTAL_COMP_SUMMARY,
      status: LetterStatus.GENERATING,
      subject: '2026 Total Compensation Statement',
      content: '',
      compData: { baseSalary: 140000, bonus: 14000, benefits: 18500, equity: 0, totalComp: 172500 },
    },
  ];

  for (const lt of lettersData) {
    const emp = createdEmployees[lt.empIdx]!;
    await prisma.compensationLetter.upsert({
      where: { id: lt.id },
      update: {},
      create: {
        id: lt.id,
        tenantId: tenant.id,
        userId: admin.id,
        employeeId: emp.id,
        letterType: lt.type,
        status: lt.status,
        subject: lt.subject,
        content: lt.content,
        compData: lt.compData,
        tone: 'professional',
        language: 'en',
        generatedAt:
          lt.status !== LetterStatus.GENERATING ? new Date('2026-02-15T09:00:00Z') : undefined,
        approvedAt: lt.approvedAt ?? undefined,
        sentAt: lt.sentAt ?? undefined,
      },
    });
  }
  console.log('  ✅ Compensation Letters: 5 created');

  // ─────────────────────────────────────────────────────────────
  // 16. Calibration Sessions (2)
  // ─────────────────────────────────────────────────────────────
  await prisma.calibrationSession.upsert({
    where: { id: 'seed-calibration-eng' },
    update: {},
    create: {
      id: 'seed-calibration-eng',
      cycleId: meritCycle.id,
      name: 'Engineering Merit Calibration',
      status: CycleStatus.ACTIVE,
      participants: [
        { userId: admin.id, role: 'facilitator' },
        { employeeCode: 'ENG-001', name: 'Priya Kumar', role: 'VP reviewer' },
      ],
      outcomes: {
        adjustments: 3,
        totalBudgetImpact: 12500,
        notes: 'Calibrated mid-level pay equity gaps; adjusted 3 recommendations upward.',
      },
    },
  });

  await prisma.calibrationSession.upsert({
    where: { id: 'seed-calibration-sales' },
    update: {},
    create: {
      id: 'seed-calibration-sales',
      cycleId: 'seed-cycle-bonus-q4',
      name: 'Sales Q4 Bonus Calibration',
      status: CycleStatus.COMPLETED,
      participants: [
        { userId: admin.id, role: 'facilitator' },
        { employeeCode: 'SAL-001', name: 'Michael Brooks', role: 'VP reviewer' },
      ],
      outcomes: {
        adjustments: 2,
        totalBudgetImpact: 8000,
        notes: 'Finalized bonus allocations. Two adjustments made for top performers.',
      },
    },
  });
  console.log('  ✅ Calibration Sessions: 2 created');

  // ─────────────────────────────────────────────────────────────
  // 17. Notifications (8 total including welcome)
  // ─────────────────────────────────────────────────────────────
  const additionalNotifications = [
    {
      id: 'seed-notification-2',
      type: 'cycle',
      title: 'Merit Cycle Started',
      body: 'The 2026 Annual Merit Review cycle is now active. Please submit recommendations by March 15.',
      metadata: { category: 'comp-cycle', cycleId: meritCycle.id },
    },
    {
      id: 'seed-notification-3',
      type: 'anomaly',
      title: 'Critical Payroll Anomaly',
      body: 'A negative net pay was detected in the February 2026 payroll run. Immediate review required.',
      metadata: { category: 'payroll', anomalyId: 'seed-anomaly-2', severity: 'critical' },
    },
    {
      id: 'seed-notification-4',
      type: 'rule',
      title: 'Rule Set Updated',
      body: 'Standard Merit Rules have been activated with 3 rules. Review the configuration.',
      metadata: { category: 'rules-engine', ruleSetId: meritRuleSet.id },
    },
    {
      id: 'seed-notification-5',
      type: 'compliance',
      title: 'Compliance Scan Complete',
      body: 'Your compliance scan scored 82/100. 3 warnings and 2 info findings require attention.',
      metadata: { category: 'compliance', scanId: complianceScan.id },
    },
    {
      id: 'seed-notification-6',
      type: 'benefits',
      title: 'Open Enrollment Reminder',
      body: '2026 Open Enrollment closes January 31. 8 employees have not yet made their elections.',
      metadata: { category: 'benefits', windowId: 'seed-enrollment-window-2026' },
    },
    {
      id: 'seed-notification-7',
      type: 'cycle',
      title: 'Promotion Cycle Starting',
      body: 'The 2026 Promotion Review cycle will begin April 1. Budget allocations are being finalized.',
      metadata: { category: 'comp-cycle', cycleId: 'seed-cycle-promo' },
    },
    {
      id: 'seed-notification-8',
      type: 'report',
      title: 'Report Ready',
      body: 'Your Q1 2026 Compensation Summary report has been generated and is ready for review.',
      metadata: { category: 'reports', reportId: 'seed-report-1' },
    },
  ];

  for (const notif of additionalNotifications) {
    await prisma.notification.upsert({
      where: { id: notif.id },
      update: {},
      create: {
        ...notif,
        tenantId: tenant.id,
        userId: admin.id,
      },
    });
  }
  console.log(
    `  ✅ Notifications: ${additionalNotifications.length + 1} total (including welcome)`,
  );

  // ─────────────────────────────────────────────────────────────
  // Multi-Currency: Exchange Rates & Tenant Currency Settings
  // ─────────────────────────────────────────────────────────────

  const exchangeRates = [
    { from: 'USD', to: 'EUR', rate: 0.9215 },
    { from: 'USD', to: 'GBP', rate: 0.7892 },
    { from: 'USD', to: 'INR', rate: 83.125 },
    { from: 'USD', to: 'SGD', rate: 1.3428 },
    { from: 'USD', to: 'AUD', rate: 1.5342 },
    { from: 'USD', to: 'CAD', rate: 1.3586 },
  ];

  for (const er of exchangeRates) {
    await prisma.exchangeRate.upsert({
      where: { id: `seed-rate-${er.from}-${er.to}` },
      update: { rate: er.rate },
      create: {
        id: `seed-rate-${er.from}-${er.to}`,
        tenantId: tenant.id,
        fromCurrency: er.from,
        toCurrency: er.to,
        rate: er.rate,
        source: 'MANUAL',
        effectiveDate: new Date('2026-02-01'),
      },
    });
  }
  console.log(`  ✅ Exchange rates: ${exchangeRates.length} created`);

  await prisma.tenantCurrency.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      baseCurrency: 'USD',
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'INR', 'SGD', 'AUD', 'CAD'],
      displayFormat: {},
    },
  });
  console.log('  ✅ Tenant currency settings created');

  // ─────────────────────────────────────────────────────────────
  // Ad Hoc / Off-Cycle Increases
  // ─────────────────────────────────────────────────────────────
  const adHocRequests = [
    {
      id: 'seed-adhoc-1',
      empCode: 'ENG-003',
      type: 'SPOT_BONUS' as const,
      reason: 'Outstanding contribution to Q1 product launch — led critical migration effort.',
      currentValue: 120000,
      proposedValue: 125000,
      effectiveDate: new Date('2026-03-01'),
      status: 'DRAFT' as const,
    },
    {
      id: 'seed-adhoc-2',
      empCode: 'ENG-005',
      type: 'RETENTION_BONUS' as const,
      reason: 'Counter-offer retention — competing offer from major tech company.',
      currentValue: 145000,
      proposedValue: 165000,
      effectiveDate: new Date('2026-03-15'),
      status: 'DRAFT' as const,
    },
    {
      id: 'seed-adhoc-3',
      empCode: 'SAL-002',
      type: 'MARKET_ADJUSTMENT' as const,
      reason: 'Market data shows 12% below median for role and location.',
      currentValue: 95000,
      proposedValue: 106000,
      effectiveDate: new Date('2026-04-01'),
      status: 'PENDING_APPROVAL' as const,
    },
    {
      id: 'seed-adhoc-4',
      empCode: 'MKT-001',
      type: 'PROMOTION' as const,
      reason: 'Promotion from Marketing Manager to Senior Marketing Manager.',
      currentValue: 110000,
      proposedValue: 130000,
      effectiveDate: new Date('2026-04-01'),
      status: 'PENDING_APPROVAL' as const,
    },
    {
      id: 'seed-adhoc-5',
      empCode: 'FIN-002',
      type: 'EQUITY_ADJUSTMENT' as const,
      reason: 'Pay equity adjustment — internal analysis identified gap vs peers.',
      currentValue: 88000,
      proposedValue: 95000,
      effectiveDate: new Date('2026-02-01'),
      status: 'APPROVED' as const,
    },
    {
      id: 'seed-adhoc-6',
      empCode: 'ENG-001',
      type: 'SPOT_BONUS' as const,
      reason: 'Led successful architecture redesign reducing infrastructure costs by 30%.',
      currentValue: 185000,
      proposedValue: 195000,
      effectiveDate: new Date('2026-02-15'),
      status: 'APPROVED' as const,
    },
    {
      id: 'seed-adhoc-7',
      empCode: 'HR-001',
      type: 'OTHER' as const,
      reason: 'Role expansion — taking on additional compliance responsibilities.',
      currentValue: 105000,
      proposedValue: 115000,
      effectiveDate: new Date('2026-01-15'),
      status: 'REJECTED' as const,
    },
    {
      id: 'seed-adhoc-8',
      empCode: 'ENG-002',
      type: 'MARKET_ADJUSTMENT' as const,
      reason: 'Annual market adjustment based on updated salary survey data.',
      currentValue: 155000,
      proposedValue: 162000,
      effectiveDate: new Date('2026-01-01'),
      status: 'APPLIED' as const,
    },
  ];

  for (const req of adHocRequests) {
    const emp = createdEmployees.find((e) => e.code === req.empCode);
    if (!emp) continue;
    await prisma.adHocIncrease.upsert({
      where: { id: req.id },
      update: {},
      create: {
        id: req.id,
        tenantId: tenant.id,
        employeeId: emp.id,
        requestedById: admin.id,
        type: req.type,
        reason: req.reason,
        currentValue: req.currentValue,
        proposedValue: req.proposedValue,
        currency: 'USD',
        effectiveDate: req.effectiveDate,
        status: req.status,
        approverUserId: ['APPROVED', 'REJECTED', 'APPLIED'].includes(req.status) ? admin.id : null,
        approvedAt: ['APPROVED', 'APPLIED'].includes(req.status) ? new Date('2026-02-20') : null,
        rejectionReason:
          req.status === 'REJECTED' ? 'Budget constraints — defer to next cycle.' : null,
        appliedAt: req.status === 'APPLIED' ? new Date('2026-02-25') : null,
        metadata: {},
      },
    });
  }
  console.log(`  ✅ Ad Hoc Increases: ${adHocRequests.length} created`);

  // ── Rewards Statements ──────────────────────────────────────
  const statementEmployees = await prisma.employee.findMany({
    where: { tenantId: tenant.id },
    take: 4,
    orderBy: { employeeCode: 'asc' },
  });

  const statementData = [
    { status: StatementStatus.GENERATED, year: 2026, daysAgo: 5 },
    { status: StatementStatus.SENT, year: 2026, daysAgo: 10 },
    { status: StatementStatus.GENERATED, year: 2025, daysAgo: 30 },
    { status: StatementStatus.DRAFT, year: 2026, daysAgo: 1 },
  ];

  for (let i = 0; i < Math.min(statementEmployees.length, statementData.length); i++) {
    const emp = statementEmployees[i]!;
    const sd = statementData[i]!;
    const genDate = new Date();
    genDate.setDate(genDate.getDate() - sd.daysAgo);

    await prisma.rewardsStatement.upsert({
      where: { id: `stmt-seed-${i + 1}` },
      update: {},
      create: {
        id: `stmt-seed-${i + 1}`,
        tenantId: tenant.id,
        employeeId: emp.id,
        year: sd.year,
        status: sd.status,
        generatedAt: genDate,
        pdfUrl:
          sd.status !== StatementStatus.DRAFT
            ? `/uploads/statements/${tenant.id}/statement-${emp.id}-${sd.year}.pdf`
            : null,
        emailSentAt: sd.status === StatementStatus.SENT ? genDate : null,
        emailTo: sd.status === StatementStatus.SENT ? emp.email : null,
        config: {
          totalRewardsValue: Number(emp.totalComp),
          breakdown: [
            { category: 'Base Salary', value: Number(emp.baseSalary) },
            {
              category: 'Bonus / Variable',
              value: Math.max(0, Number(emp.totalComp) - Number(emp.baseSalary)),
            },
          ],
        },
      },
    });
  }
  console.log(
    `  ✅ Rewards Statements: ${Math.min(statementEmployees.length, statementData.length)} created`,
  );

  // ── Equity Plans & Grants ──────────────────────────────────────────
  const rsuPlan = await prisma.equityPlan.upsert({
    where: { id: 'eq-plan-rsu-2026' },
    update: {},
    create: {
      id: 'eq-plan-rsu-2026',
      tenantId: tenant.id,
      name: '2026 RSU Plan',
      planType: EquityGrantType.RSU,
      totalSharesAuthorized: 10000000,
      sharesIssued: 0,
      sharesAvailable: 10000000,
      sharePrice: 42.5,
      currency: 'USD',
      effectiveDate: new Date('2026-01-01'),
      expirationDate: new Date('2036-01-01'),
      description: 'Company-wide RSU plan for all employees',
      isActive: true,
    },
  });

  const isoPlan = await prisma.equityPlan.upsert({
    where: { id: 'eq-plan-iso-2026' },
    update: {},
    create: {
      id: 'eq-plan-iso-2026',
      tenantId: tenant.id,
      name: '2026 ISO Plan',
      planType: EquityGrantType.ISO,
      totalSharesAuthorized: 5000000,
      sharesIssued: 0,
      sharesAvailable: 5000000,
      sharePrice: 38.0,
      currency: 'USD',
      effectiveDate: new Date('2026-01-01'),
      expirationDate: new Date('2036-01-01'),
      description: 'Incentive Stock Option plan for US employees',
      isActive: true,
    },
  });
  console.log('  ✅ Equity Plans: 2 created (RSU + ISO)');

  // Equity grants for various employees
  const equityGrantData = [
    {
      empCode: 'ENG-001',
      planId: rsuPlan.id,
      type: EquityGrantType.RSU,
      shares: 10000,
      price: 42.5,
      date: '2025-03-15',
      schedule: VestingScheduleType.STANDARD_4Y_1Y_CLIFF,
    },
    {
      empCode: 'ENG-002',
      planId: rsuPlan.id,
      type: EquityGrantType.RSU,
      shares: 5000,
      price: 42.5,
      date: '2025-06-01',
      schedule: VestingScheduleType.STANDARD_4Y_1Y_CLIFF,
    },
    {
      empCode: 'ENG-003',
      planId: isoPlan.id,
      type: EquityGrantType.ISO,
      shares: 8000,
      price: 38.0,
      date: '2025-01-15',
      schedule: VestingScheduleType.STANDARD_4Y_1Y_CLIFF,
    },
    {
      empCode: 'ENG-004',
      planId: rsuPlan.id,
      type: EquityGrantType.RSU,
      shares: 3000,
      price: 42.5,
      date: '2025-09-01',
      schedule: VestingScheduleType.QUARTERLY,
    },
    {
      empCode: 'SAL-001',
      planId: rsuPlan.id,
      type: EquityGrantType.RSU,
      shares: 7500,
      price: 42.5,
      date: '2025-04-01',
      schedule: VestingScheduleType.STANDARD_4Y_1Y_CLIFF,
    },
    {
      empCode: 'SAL-002',
      planId: rsuPlan.id,
      type: EquityGrantType.RSU,
      shares: 4000,
      price: 42.5,
      date: '2025-07-15',
      schedule: VestingScheduleType.MONTHLY,
    },
    {
      empCode: 'HR-001',
      planId: isoPlan.id,
      type: EquityGrantType.ISO,
      shares: 6000,
      price: 38.0,
      date: '2025-02-01',
      schedule: VestingScheduleType.STANDARD_4Y_1Y_CLIFF,
    },
    {
      empCode: 'FIN-001',
      planId: rsuPlan.id,
      type: EquityGrantType.RSU,
      shares: 5500,
      price: 42.5,
      date: '2025-05-01',
      schedule: VestingScheduleType.ANNUAL,
    },
    {
      empCode: 'ENG-005',
      planId: rsuPlan.id,
      type: EquityGrantType.RSU,
      shares: 2500,
      price: 45.0,
      date: '2026-01-15',
      schedule: VestingScheduleType.STANDARD_4Y_1Y_CLIFF,
    },
    {
      empCode: 'MKT-001',
      planId: rsuPlan.id,
      type: EquityGrantType.RSU,
      shares: 3500,
      price: 42.5,
      date: '2025-08-01',
      schedule: VestingScheduleType.QUARTERLY,
    },
  ];

  let totalSharesIssued_rsu = 0;
  let totalSharesIssued_iso = 0;

  for (const g of equityGrantData) {
    const emp = createdEmployees.find((e) => e.code === g.empCode);
    if (!emp) continue;

    const grantId = `eq-grant-${g.empCode.toLowerCase()}-${g.type.toLowerCase()}`;
    const vestingStartDate = new Date(g.date);
    const cliffMonths = g.schedule === VestingScheduleType.STANDARD_4Y_1Y_CLIFF ? 12 : 0;
    const vestingMonths = 48;

    await prisma.equityGrant.upsert({
      where: { id: grantId },
      update: {},
      create: {
        id: grantId,
        tenantId: tenant.id,
        employeeId: emp.id,
        planId: g.planId,
        grantType: g.type,
        grantDate: new Date(g.date),
        totalShares: g.shares,
        vestedShares: 0,
        exercisedShares: 0,
        grantPrice: g.price,
        currentPrice: 55.0, // current market price
        vestingScheduleType: g.schedule,
        vestingStartDate,
        cliffMonths,
        vestingMonths,
        status: EquityGrantStatus.ACTIVE,
      },
    });

    if (g.planId === rsuPlan.id) totalSharesIssued_rsu += g.shares;
    else totalSharesIssued_iso += g.shares;

    // Generate vesting events
    const events: Array<{
      grantId: string;
      vestDate: Date;
      sharesVested: number;
      cumulativeVested: number;
      status: VestingEventStatus;
    }> = [];

    if (g.schedule === VestingScheduleType.STANDARD_4Y_1Y_CLIFF) {
      const cliffShares = Math.floor(g.shares * 0.25);
      const remaining = g.shares - cliffShares;
      const monthsAfterCliff = vestingMonths - cliffMonths;
      const monthly = monthsAfterCliff > 0 ? Math.floor(remaining / monthsAfterCliff) : 0;
      let cum = 0;
      const cliffDate = new Date(vestingStartDate);
      cliffDate.setMonth(cliffDate.getMonth() + cliffMonths);
      cum += cliffShares;
      events.push({
        grantId,
        vestDate: cliffDate,
        sharesVested: cliffShares,
        cumulativeVested: cum,
        status: VestingEventStatus.SCHEDULED,
      });
      let alloc = cliffShares;
      for (let m = 1; m <= monthsAfterCliff; m++) {
        const vd = new Date(cliffDate);
        vd.setMonth(vd.getMonth() + m);
        const s = m === monthsAfterCliff ? g.shares - alloc : monthly;
        alloc += s;
        cum += s;
        events.push({
          grantId,
          vestDate: vd,
          sharesVested: s,
          cumulativeVested: cum,
          status: VestingEventStatus.SCHEDULED,
        });
      }
    } else if (g.schedule === VestingScheduleType.QUARTERLY) {
      const quarters = Math.floor(vestingMonths / 3);
      const qShares = Math.floor(g.shares / quarters);
      let cum = 0,
        alloc = 0;
      for (let q = 1; q <= quarters; q++) {
        const vd = new Date(vestingStartDate);
        vd.setMonth(vd.getMonth() + q * 3);
        const s = q === quarters ? g.shares - alloc : qShares;
        alloc += s;
        cum += s;
        events.push({
          grantId,
          vestDate: vd,
          sharesVested: s,
          cumulativeVested: cum,
          status: VestingEventStatus.SCHEDULED,
        });
      }
    } else if (g.schedule === VestingScheduleType.MONTHLY) {
      const mShares = Math.floor(g.shares / vestingMonths);
      let cum = 0,
        alloc = 0;
      for (let m = 1; m <= vestingMonths; m++) {
        const vd = new Date(vestingStartDate);
        vd.setMonth(vd.getMonth() + m);
        const s = m === vestingMonths ? g.shares - alloc : mShares;
        alloc += s;
        cum += s;
        events.push({
          grantId,
          vestDate: vd,
          sharesVested: s,
          cumulativeVested: cum,
          status: VestingEventStatus.SCHEDULED,
        });
      }
    } else if (g.schedule === VestingScheduleType.ANNUAL) {
      const years = Math.floor(vestingMonths / 12);
      const yShares = Math.floor(g.shares / years);
      let cum = 0,
        alloc = 0;
      for (let y = 1; y <= years; y++) {
        const vd = new Date(vestingStartDate);
        vd.setFullYear(vd.getFullYear() + y);
        const s = y === years ? g.shares - alloc : yShares;
        alloc += s;
        cum += s;
        events.push({
          grantId,
          vestDate: vd,
          sharesVested: s,
          cumulativeVested: cum,
          status: VestingEventStatus.SCHEDULED,
        });
      }
    }

    // Delete existing events for this grant and recreate
    await prisma.vestingEvent.deleteMany({ where: { grantId } });
    if (events.length > 0) {
      await prisma.vestingEvent.createMany({ data: events });
    }
  }

  // Update plan shares issued/available
  await prisma.equityPlan.update({
    where: { id: rsuPlan.id },
    data: {
      sharesIssued: totalSharesIssued_rsu,
      sharesAvailable: rsuPlan.totalSharesAuthorized - totalSharesIssued_rsu,
    },
  });
  await prisma.equityPlan.update({
    where: { id: isoPlan.id },
    data: {
      sharesIssued: totalSharesIssued_iso,
      sharesAvailable: isoPlan.totalSharesAuthorized - totalSharesIssued_iso,
    },
  });
  console.log(`  ✅ Equity Grants: ${equityGrantData.length} created with vesting events`);

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
