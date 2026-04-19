/**
 * seed-demo.ts — Creates a "Demo Corp" tenant with 5000 employees
 * and full compensation & benefits data across all domains.
 *
 * Usage: npx tsx prisma/seed-demo.ts
 *
 * Covers: Employees, Salary Bands, Comp Cycles, Recommendations,
 * Rules, Payroll, Benefits, Equity, Letters, Attrition Risk, Market Data
 */
import 'dotenv/config';
import {
  PrismaClient,
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
  LetterType,
  LetterStatus,
  MarketDataProvider,
  EquityGrantType,
  EquityGrantStatus,
  VestingScheduleType,
  AttritionRiskLevel,
} from '../src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcryptjs';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=') ? { rejectUnauthorized: false } : undefined,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function setRlsTenantContext(tenantId: string) {
  await pool.query(`SET app.current_tenant_id = '${tenantId}'`);
}

// ─── Data Constants ─────────────────────────────────────────

const DEPARTMENTS = [
  'Engineering',
  'Product',
  'Sales',
  'Marketing',
  'Finance',
  'Human Resources',
  'Operations',
  'Legal',
  'Customer Success',
  'Data Science',
  'Design',
  'IT Infrastructure',
  'Compliance',
  'Risk Management',
  'Strategy',
];

const LEVELS = ['IC1', 'IC2', 'IC3', 'IC4', 'IC5', 'M1', 'M2', 'M3', 'VP', 'SVP'];

const LOCATIONS = [
  'San Francisco',
  'New York',
  'Seattle',
  'Austin',
  'Boston',
  'Chicago',
  'Denver',
  'Los Angeles',
  'Atlanta',
  'Miami',
];

const JOB_FAMILIES = [
  'Software Engineering',
  'Product Management',
  'Sales',
  'Marketing',
  'Finance & Accounting',
  'People Operations',
  'Operations',
  'Legal',
  'Customer Success',
  'Data & Analytics',
  'Design',
  'Infrastructure',
];

const FIRST_NAMES = [
  'James',
  'Emma',
  'Michael',
  'Olivia',
  'Robert',
  'Sophia',
  'David',
  'Isabella',
  'William',
  'Mia',
  'Sarah',
  'Daniel',
  'Emily',
  'Matthew',
  'Chloe',
  'Andrew',
  'Jessica',
  'Ryan',
  'Ashley',
  'Tyler',
  'Brandon',
  'Samantha',
  'Justin',
  'Lauren',
  'Kevin',
  'Rachel',
  'Brian',
  'Megan',
  'Jason',
  'Nicole',
  'Christine',
  'Patrick',
  'Jennifer',
  'Eric',
  'Amanda',
  'Steven',
  'Heather',
  'Marcus',
  'Taylor',
  'Alex',
];

const LAST_NAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Jackson',
  'White',
  'Harris',
  'Martin',
  'Thompson',
  'Moore',
  'Allen',
  'Young',
  'King',
  'Wright',
  'Scott',
  'Adams',
  'Baker',
  'Nelson',
  'Carter',
  'Mitchell',
  'Campbell',
];

// Salary ranges in USD by level (annual base)
const SALARY_RANGES: Record<string, [number, number]> = {
  IC1: [55000, 85000],
  IC2: [80000, 130000],
  IC3: [120000, 185000],
  IC4: [160000, 250000],
  IC5: [220000, 350000],
  M1: [150000, 230000],
  M2: [200000, 320000],
  M3: [280000, 420000],
  VP: [350000, 550000],
  SVP: [450000, 750000],
};

// ─── Helpers ────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randDec(min: number, max: number) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}
function randDate(start: Date, end: Date) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}
function cuid() {
  return 'c' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).substring(4);
}

async function main() {
  console.log('🌱 Seeding Demo Corp with 5000 employees...\n');

  const passwordHash = await bcrypt.hash('Demo@2026!', 12);

  // ═══ 1. TENANT ═══════════════════════════════════════════
  console.log('1/12 Creating tenant...');
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-corp' },
    update: {},
    create: {
      name: 'Demo Corp',
      slug: 'demo-corp',
      subdomain: 'demo',
      plan: 'enterprise',
      settings: {
        features: [
          'data-hygiene',
          'rules-engine',
          'comp-cycles',
          'payroll',
          'benefits',
          'equity',
          'letters',
          'analytics',
        ],
        currency: 'USD',
        country: 'United States',
      },
    },
  });
  const T = tenant.id;
  await setRlsTenantContext(T);

  // ═══ 2. ADMIN USER ═══════════════════════════════════════
  console.log('2/12 Creating admin user...');
  await prisma.user.upsert({
    where: { tenantId_email: { email: 'admin@demo.compportiq.ai', tenantId: T } },
    update: {},
    create: {
      tenantId: T,
      email: 'admin@demo.compportiq.ai',
      name: 'Demo Admin',
      passwordHash,
      role: 'ADMIN',
    },
  });

  // ═══ 3. EMPLOYEES (5000) ═════════════════════════════════
  console.log('3/12 Creating 5000 employees...');
  const employees: {
    id: string;
    dept: string;
    level: string;
    salary: number;
    location: string;
    jobFamily: string;
    perf: number;
    gender: string;
  }[] = [];
  const empBatch = [];

  // Create 50 managers first (M1-SVP)
  const managerIds: string[] = [];
  for (let i = 0; i < 50; i++) {
    const id = cuid();
    managerIds.push(id);
    const level = pick(['M1', 'M2', 'M3', 'VP', 'SVP']);
    const dept = DEPARTMENTS[i % DEPARTMENTS.length]!;
    const [min, max] = SALARY_RANGES[level]!;
    const salary = randInt(min, max);
    const loc = pick(LOCATIONS);
    const jf = JOB_FAMILIES[i % JOB_FAMILIES.length]!;
    const perf = randDec(2.0, 5.0);
    const gender = Math.random() > 0.45 ? 'Male' : 'Female';
    employees.push({ id, dept, level, salary, location: loc, jobFamily: jf, perf, gender });
    empBatch.push({
      id,
      tenantId: T,
      employeeCode: `DC${String(i + 1).padStart(5, '0')}`,
      email: `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}${i}@democorp.com`,
      firstName: pick(FIRST_NAMES),
      lastName: pick(LAST_NAMES),
      department: dept,
      level,
      location: loc,
      hireDate: randDate(new Date('2015-01-01'), new Date('2024-06-01')),
      currency: 'USD',
      baseSalary: salary,
      totalComp: Math.round(salary * randDec(1.1, 1.4)),
      totalCashComp: Math.round(salary * randDec(1.05, 1.25)),
      performanceRating: perf,
      jobFamily: jf,
      compaRatio: randDec(0.75, 1.3),
      gender,
      dateOfBirth: randDate(new Date('1970-01-01'), new Date('2000-12-31')),
      isPeopleManager: true,
      ftePercent: 100,
      metadata: {},
    });
  }

  // Create 4950 ICs
  for (let i = 50; i < 5000; i++) {
    const id = cuid();
    const level = pick(['IC1', 'IC2', 'IC3', 'IC4', 'IC5']);
    const dept = pick(DEPARTMENTS);
    const [min, max] = SALARY_RANGES[level]!;
    const salary = randInt(min, max);
    const loc = pick(LOCATIONS);
    const jf = pick(JOB_FAMILIES);
    const perf = randDec(1.0, 5.0);
    const gender = Math.random() > 0.45 ? 'Male' : 'Female';
    employees.push({ id, dept, level, salary, location: loc, jobFamily: jf, perf, gender });
    empBatch.push({
      id,
      tenantId: T,
      employeeCode: `DC${String(i + 1).padStart(5, '0')}`,
      email: `emp${i}@democorp.com`,
      firstName: pick(FIRST_NAMES),
      lastName: pick(LAST_NAMES),
      department: dept,
      level,
      location: loc,
      managerId: pick(managerIds),
      hireDate: randDate(new Date('2018-01-01'), new Date('2025-12-01')),
      currency: 'USD',
      baseSalary: salary,
      totalComp: Math.round(salary * randDec(1.1, 1.4)),
      totalCashComp: Math.round(salary * randDec(1.05, 1.25)),
      performanceRating: perf,
      jobFamily: jf,
      compaRatio: randDec(0.75, 1.3),
      gender,
      dateOfBirth: randDate(new Date('1975-01-01'), new Date('2002-12-31')),
      isPeopleManager: false,
      ftePercent: 100,
      metadata: {},
    });
  }

  // Insert in chunks of 500
  for (let i = 0; i < empBatch.length; i += 500) {
    const chunk = empBatch.slice(i, i + 500);
    await prisma.employee.createMany({ data: chunk as never, skipDuplicates: true });
    process.stdout.write(`  ${Math.min(i + 500, empBatch.length)}/${empBatch.length}\r`);
  }
  console.log(`  ✅ ${empBatch.length} employees created`);

  // ═══ 4. SALARY BANDS ═════════════════════════════════════
  console.log('4/12 Creating salary bands...');
  const bandData = [];
  for (const jf of JOB_FAMILIES) {
    for (const level of LEVELS) {
      const [min, max] = SALARY_RANGES[level]!;
      const p50 = Math.round((min + max) / 2);
      bandData.push({
        tenantId: T,
        jobFamily: jf,
        level,
        currency: 'USD',
        p10: Math.round(p50 * 0.7),
        p25: Math.round(p50 * 0.85),
        p50,
        p75: Math.round(p50 * 1.15),
        p90: Math.round(p50 * 1.35),
        source: 'Radford Global Tech Survey 2025',
        effectiveDate: new Date('2025-04-01'),
      });
    }
  }
  await prisma.salaryBand.createMany({ data: bandData as never, skipDuplicates: true });
  console.log(`  ✅ ${bandData.length} salary bands`);

  // ═══ 5. MARKET DATA SOURCES ═══════════════════════════════
  console.log('5/12 Creating market data sources...');
  await prisma.marketDataSource.createMany({
    data: [
      {
        tenantId: T,
        name: 'Radford Global Technology Survey 2025',
        provider: MarketDataProvider.RADFORD,
        config: { region: 'US', industry: 'Technology' },
        surveyDate: new Date('2025-03-01'),
        ageingRate: 0.035,
        blendWeight: 40,
        status: 'ACTIVE',
      },
      {
        tenantId: T,
        name: 'Mercer Total Remuneration Survey 2025',
        provider: MarketDataProvider.MERCER,
        config: { region: 'US', industry: 'Cross-Industry' },
        surveyDate: new Date('2025-01-15'),
        ageingRate: 0.032,
        blendWeight: 30,
        status: 'ACTIVE',
      },
      {
        tenantId: T,
        name: 'Korn Ferry Hay Group 2025',
        provider: MarketDataProvider.KORN_FERRY,
        config: { region: 'US', methodology: 'Hay Points' },
        surveyDate: new Date('2025-02-01'),
        ageingRate: 0.033,
        blendWeight: 20,
        status: 'ACTIVE',
      },
      {
        tenantId: T,
        name: 'PayScale MarketPay 2025',
        provider: MarketDataProvider.PAYSCALE,
        config: { region: 'US', source: 'Crowd-sourced' },
        surveyDate: new Date('2025-04-01'),
        ageingRate: 0.04,
        blendWeight: 10,
        status: 'ACTIVE',
      },
    ],
    skipDuplicates: true,
  });
  console.log('  ✅ 4 market data sources (Radford, Mercer, Korn Ferry, PayScale)');

  // ═══ 6. COMP CYCLES + RECOMMENDATIONS ════════════════════
  console.log('6/12 Creating comp cycles...');
  const activeCycle = await prisma.compCycle.create({
    data: {
      tenantId: T,
      name: '2026 Annual Merit Review',
      cycleType: CycleType.COMBINED,
      status: CycleStatus.ACTIVE,
      budgetTotal: 75000000,
      currency: 'USD',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-06-30'),
      settings: { meritBudgetPct: 8, bonusBudgetPct: 12 },
    },
  });
  const completedCycle = await prisma.compCycle.create({
    data: {
      tenantId: T,
      name: '2025 Annual Review',
      cycleType: CycleType.MERIT,
      status: CycleStatus.COMPLETED,
      budgetTotal: 60000000,
      currency: 'USD',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-06-30'),
      settings: {},
    },
  });

  // Budget per department
  for (const dept of DEPARTMENTS) {
    await prisma.cycleBudget.create({
      data: {
        cycleId: activeCycle.id,
        department: dept,
        allocated: 5000000,
        spent: randInt(1500000, 4000000),
        remaining: randInt(800000, 3500000),
      },
    });
  }

  // Recommendations for 2000 employees in active cycle
  console.log('  Creating recommendations...');
  const recBatch = [];
  const recTypes = [
    RecommendationType.MERIT_INCREASE,
    RecommendationType.BONUS,
    RecommendationType.PROMOTION,
  ];
  const recStatuses = [
    RecommendationStatus.DRAFT,
    RecommendationStatus.SUBMITTED,
    RecommendationStatus.APPROVED,
  ];
  for (let i = 0; i < 2000; i++) {
    const emp = employees[i]!;
    const pct = randDec(3, 15);
    recBatch.push({
      cycleId: activeCycle.id,
      employeeId: emp.id,
      recType: pick(recTypes),
      currentValue: emp.salary,
      proposedValue: Math.round(emp.salary * (1 + pct / 100)),
      justification: `Performance rating ${emp.perf.toFixed(1)}, ${pct.toFixed(1)}% increase recommended`,
      status: pick(recStatuses),
    });
  }
  for (let i = 0; i < recBatch.length; i += 500) {
    await prisma.compRecommendation.createMany({
      data: recBatch.slice(i, i + 500) as never,
      skipDuplicates: true,
    });
  }
  console.log(`  ✅ ${recBatch.length} recommendations`);

  // ═══ 7. RULES ════════════════════════════════════════════
  console.log('7/12 Creating rule sets...');
  const ruleSet = await prisma.ruleSet.create({
    data: {
      tenantId: T,
      name: '2026 Merit & Bonus Rules',
      description: 'Standard merit and bonus rules for FY2026',
      status: RuleSetStatus.ACTIVE,
      effectiveDate: new Date('2026-04-01'),
      rules: {
        create: [
          {
            name: 'Top Performer Merit',
            ruleType: RuleType.MERIT,
            priority: 1,
            enabled: true,
            conditions: { performanceRating: { gte: 4.0 }, compaRatio: { lte: 1.1 } },
            actions: { meritIncreasePct: 12, minIncrease: 5000 },
            metadata: {},
          },
          {
            name: 'Solid Performer Merit',
            ruleType: RuleType.MERIT,
            priority: 2,
            enabled: true,
            conditions: { performanceRating: { gte: 3.0, lt: 4.0 } },
            actions: { meritIncreasePct: 7 },
            metadata: {},
          },
          {
            name: 'Below Average Merit',
            ruleType: RuleType.MERIT,
            priority: 3,
            enabled: true,
            conditions: { performanceRating: { lt: 3.0 } },
            actions: { meritIncreasePct: 3 },
            metadata: {},
          },
          {
            name: 'Q1 Bonus Payout',
            ruleType: RuleType.BONUS,
            priority: 1,
            enabled: true,
            conditions: { performanceRating: { gte: 3.5 } },
            actions: { bonusPct: 15, maxBonus: 75000 },
            metadata: {},
          },
          {
            name: 'Salary Cap',
            ruleType: RuleType.CAP,
            priority: 10,
            enabled: true,
            conditions: {},
            actions: { maxSalary: 800000, maxIncreasePct: 25 },
            metadata: {},
          },
          {
            name: 'Minimum Floor',
            ruleType: RuleType.FLOOR,
            priority: 11,
            enabled: true,
            conditions: {},
            actions: { minSalary: 50000, minIncreasePct: 3 },
            metadata: {},
          },
          {
            name: 'Probation Eligibility',
            ruleType: RuleType.ELIGIBILITY,
            priority: 0,
            enabled: true,
            conditions: { tenureMonths: { gte: 6 } },
            actions: { eligible: true },
            metadata: {},
          },
          {
            name: 'LTI for Senior Staff',
            ruleType: RuleType.LTI,
            priority: 5,
            enabled: true,
            conditions: {
              level: { in: ['IC4', 'IC5', 'M2', 'M3', 'VP', 'SVP'] },
              performanceRating: { gte: 3.5 },
            },
            actions: { ltiMultiplier: 0.2, vestingMonths: 48 },
            metadata: {},
          },
        ],
      },
    },
  });
  console.log(`  ✅ Rule set with 8 rules`);

  // ═══ 8. PAYROLL ══════════════════════════════════════════
  console.log('8/12 Creating payroll runs...');
  const months = ['2026-01', '2026-02', '2026-03'];
  for (const period of months) {
    const run = await prisma.payrollRun.create({
      data: {
        tenantId: T,
        period,
        status: period === '2026-03' ? PayrollStatus.REVIEW : PayrollStatus.FINALIZED,
        totalGross: randInt(65000000, 85000000),
        totalNet: randInt(48000000, 65000000),
        employeeCount: 5000,
      },
    });

    // Line items for 200 employees per run (sample)
    const lineItems = [];
    for (let i = 0; i < 200; i++) {
      const emp = employees[i]!;
      const monthly = Math.round(emp.salary / 12);
      lineItems.push(
        {
          payrollRunId: run.id,
          employeeId: emp.id,
          component: 'Basic',
          amount: Math.round(monthly * 0.4),
          previousAmount: Math.round(monthly * 0.38),
          delta: Math.round(monthly * 0.02),
        },
        {
          payrollRunId: run.id,
          employeeId: emp.id,
          component: 'HRA',
          amount: Math.round(monthly * 0.2),
          previousAmount: Math.round(monthly * 0.19),
          delta: Math.round(monthly * 0.01),
        },
        {
          payrollRunId: run.id,
          employeeId: emp.id,
          component: 'Special Allowance',
          amount: Math.round(monthly * 0.25),
          previousAmount: Math.round(monthly * 0.24),
          delta: Math.round(monthly * 0.01),
        },
      );
    }
    await prisma.payrollLineItem.createMany({ data: lineItems as never, skipDuplicates: true });

    // Anomalies
    const anomalies = [];
    const anomalyTypes = [
      AnomalyType.SPIKE,
      AnomalyType.DROP,
      AnomalyType.UNUSUAL_DEDUCTION,
      AnomalyType.MISSING_COMPONENT,
    ];
    const severities = [
      AnomalySeverity.CRITICAL,
      AnomalySeverity.HIGH,
      AnomalySeverity.MEDIUM,
      AnomalySeverity.LOW,
    ];
    for (let i = 0; i < 15; i++) {
      const emp = employees[randInt(0, 500)]!;
      anomalies.push({
        payrollRunId: run.id,
        employeeId: emp.id,
        anomalyType: pick(anomalyTypes),
        severity: pick(severities),
        details: { message: 'Unusual variance detected', delta: randInt(-50000, 100000) },
      });
    }
    await prisma.payrollAnomaly.createMany({ data: anomalies as never, skipDuplicates: true });
  }
  console.log(`  ✅ 3 payroll runs with line items + anomalies`);

  // ═══ 9. BENEFITS ═════════════════════════════════════════
  console.log('9/12 Creating benefit plans...');
  const plans = [
    {
      planType: BenefitPlanType.MEDICAL,
      name: 'PPO Medical Plan',
      carrier: 'Blue Cross Blue Shield',
      premiums: { employee: 250, employer: 750 },
    },
    {
      planType: BenefitPlanType.DENTAL,
      name: 'Dental PPO',
      carrier: 'Delta Dental',
      premiums: { employee: 45, employer: 135 },
    },
    {
      planType: BenefitPlanType.LIFE,
      name: 'Group Term Life 2x Salary',
      carrier: 'MetLife',
      premiums: { employee: 0, employer: 85 },
    },
    {
      planType: BenefitPlanType.DISABILITY,
      name: 'Long-Term Disability',
      carrier: 'Unum',
      premiums: { employee: 30, employer: 95 },
    },
    {
      planType: BenefitPlanType.VISION,
      name: 'Vision Plan',
      carrier: 'VSP',
      premiums: { employee: 15, employer: 25 },
    },
  ];
  const createdPlans = [];
  for (const plan of plans) {
    const p = await prisma.benefitPlan.create({
      data: {
        tenantId: T,
        ...plan,
        effectiveDate: new Date('2026-01-01'),
        description: `Company ${plan.name}`,
        deductibles: {},
        outOfPocketMax: {},
        copays: {},
        coverageDetails: {},
      },
    });
    createdPlans.push(p);
  }

  // Enroll 3000 employees
  const enrollments = [];
  const tiers = [BenefitTier.EMPLOYEE, BenefitTier.EMPLOYEE_SPOUSE, BenefitTier.FAMILY];
  for (let i = 0; i < 3000; i++) {
    const emp = employees[i]!;
    const plan = pick(createdPlans);
    enrollments.push({
      tenantId: T,
      employeeId: emp.id,
      planId: plan.id,
      tier: pick(tiers),
      status: EnrollmentStatus.ACTIVE,
      effectiveDate: new Date('2026-01-01'),
      employeePremium: randInt(500, 3000),
      employerPremium: randInt(2000, 8000),
      metadata: {},
    });
  }
  for (let i = 0; i < enrollments.length; i += 500) {
    await prisma.benefitEnrollment.createMany({
      data: enrollments.slice(i, i + 500) as never,
      skipDuplicates: true,
    });
  }
  console.log(`  ✅ 5 plans, ${enrollments.length} enrollments`);

  // ═══ 10. EQUITY ══════════════════════════════════════════
  console.log('10/12 Creating equity plans...');
  const equityPlan = await prisma.equityPlan.create({
    data: {
      tenantId: T,
      name: 'Demo Corp ESOP 2025',
      planType: EquityGrantType.RSU,
      totalSharesAuthorized: 1000000,
      sharesIssued: 250000,
      sharesAvailable: 750000,
      sharePrice: 450.0,
      currency: 'USD',
      effectiveDate: new Date('2025-01-01'),
      description: 'Employee Stock Ownership Plan',
    },
  });

  const grants = [];
  // Grant to senior employees (IC4+, M1+)
  const seniorEmps = employees.filter((e) =>
    ['IC4', 'IC5', 'M1', 'M2', 'M3', 'VP', 'SVP'].includes(e.level),
  );
  for (let i = 0; i < Math.min(seniorEmps.length, 500); i++) {
    const emp = seniorEmps[i]!;
    const shares = randInt(100, 5000);
    grants.push({
      tenantId: T,
      employeeId: emp.id,
      planId: equityPlan.id,
      grantType: EquityGrantType.RSU,
      grantDate: randDate(new Date('2025-01-01'), new Date('2026-01-01')),
      totalShares: shares,
      vestedShares: Math.floor(shares * randDec(0, 0.5)),
      grantPrice: 450.0,
      currentPrice: randDec(400, 600),
      vestingScheduleType: VestingScheduleType.STANDARD_4Y_1Y_CLIFF,
      vestingStartDate: new Date('2025-04-01'),
      cliffMonths: 12,
      vestingMonths: 48,
      status: pick([
        EquityGrantStatus.ACTIVE,
        EquityGrantStatus.PARTIALLY_VESTED,
        EquityGrantStatus.PENDING,
      ]),
      metadata: {},
    });
  }
  for (let i = 0; i < grants.length; i += 200) {
    await prisma.equityGrant.createMany({
      data: grants.slice(i, i + 200) as never,
      skipDuplicates: true,
    });
  }
  console.log(`  ✅ 1 plan, ${grants.length} grants`);

  // ═══ 11. ATTRITION RISK ══════════════════════════════════
  console.log('11/12 Creating attrition risk scores...');
  const riskBatch = [];
  const riskLevels = [
    AttritionRiskLevel.LOW,
    AttritionRiskLevel.LOW,
    AttritionRiskLevel.MEDIUM,
    AttritionRiskLevel.HIGH,
    AttritionRiskLevel.CRITICAL,
  ];
  for (let i = 0; i < 2000; i++) {
    const emp = employees[i]!;
    const riskLevel = pick(riskLevels);
    const scoreMap = {
      LOW: randInt(5, 30),
      MEDIUM: randInt(31, 55),
      HIGH: randInt(56, 80),
      CRITICAL: randInt(81, 99),
    };
    riskBatch.push({
      tenantId: T,
      employeeId: emp.id,
      riskScore: scoreMap[riskLevel],
      riskLevel,
      factors: {
        tenureYears: randDec(0.5, 15),
        compaRatio: emp.salary > 0 ? randDec(0.7, 1.3) : null,
        lastPromotionMonths: randInt(6, 60),
        managerRating: randDec(2, 5),
        marketDemand: pick(['LOW', 'MEDIUM', 'HIGH']),
      },
      recommendation:
        riskLevel === 'HIGH' || riskLevel === 'CRITICAL'
          ? `Consider retention package: ${randInt(5, 20)}% salary adjustment + role expansion`
          : null,
    });
  }
  for (let i = 0; i < riskBatch.length; i += 500) {
    await prisma.attritionRiskScore.createMany({
      data: riskBatch.slice(i, i + 500) as never,
      skipDuplicates: true,
    });
  }
  console.log(`  ✅ ${riskBatch.length} risk scores`);

  // ═══ 12. LETTERS ═════════════════════════════════════════
  console.log('12/12 Creating compensation letters...');
  const adminUser = await prisma.user.findFirst({ where: { tenantId: T, role: 'ADMIN' } });
  const letterBatch = [];
  const letterTypes = [
    LetterType.RAISE,
    LetterType.PROMOTION,
    LetterType.BONUS,
    LetterType.TOTAL_COMP_SUMMARY,
  ];
  for (let i = 0; i < 100; i++) {
    const emp = employees[i]!;
    const lt = pick(letterTypes);
    letterBatch.push({
      tenantId: T,
      userId: adminUser!.id,
      employeeId: emp.id,
      letterType: lt,
      status: pick([
        LetterStatus.DRAFT,
        LetterStatus.REVIEW,
        LetterStatus.APPROVED,
        LetterStatus.SENT,
      ]),
      subject: `${lt.replace(/_/g, ' ')} Letter - Employee DC${String(i + 1).padStart(5, '0')}`,
      content: `Dear Employee,\n\nWe are pleased to inform you about your compensation update.\n\nYour new base salary: $${(emp.salary * 1.1).toLocaleString('en-US')}\n\nBest regards,\nHR Team`,
      compData: {
        currentSalary: emp.salary,
        newSalary: Math.round(emp.salary * 1.1),
        increasePct: 10,
      },
      tone: 'professional',
      language: 'en',
      metadata: {},
    });
  }
  await prisma.compensationLetter.createMany({ data: letterBatch as never, skipDuplicates: true });
  console.log(`  ✅ ${letterBatch.length} letters`);

  // ═══ SUMMARY ═════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('✅ Demo Corp seeded successfully!');
  console.log('══════════════════════════════════════════');
  console.log(`Tenant:          Demo Corp (${T})`);
  console.log(`Login:           admin@demo.compportiq.ai / Demo@2026!`);
  console.log(`Employees:       5,000`);
  console.log(`Salary Bands:    ${bandData.length}`);
  console.log(`Comp Cycles:     2 (1 active, 1 completed)`);
  console.log(`Recommendations: ${recBatch.length}`);
  console.log(`Rule Sets:       1 (8 rules)`);
  console.log(`Payroll Runs:    3 (with line items + anomalies)`);
  console.log(`Benefit Plans:   5 (${enrollments.length} enrollments)`);
  console.log(`Equity Grants:   ${grants.length}`);
  console.log(`Attrition Risks: ${riskBatch.length}`);
  console.log(`Letters:         ${letterBatch.length}`);
  console.log('══════════════════════════════════════════\n');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
