/**
 * seed-bfl-enrich.ts — Enriches the BFL tenant with missing PG data.
 *
 * BFL has 123K employees + Compport MySQL data, but PG models like
 * SalaryBand, CompCycle, RuleSet, PayrollRun, Benefits, Equity,
 * AttritionRisk are empty. This seeds them using existing employee IDs.
 *
 * Usage: npx tsx prisma/seed-bfl-enrich.ts
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

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=') ? { rejectUnauthorized: false } : undefined,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function setRlsTenantContext(tenantId: string) {
  await pool.query(`SET app.current_tenant_id = '${tenantId}'`);
}

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

// BFL is an Indian enterprise — all values in INR
const DEPARTMENTS = [
  'Marketing',
  'AI Unit',
  'Finance & Accounts',
  'Compliance',
  'Legal',
  'Risk',
  'IT',
  'Human Resources',
  'Debt Management Services',
  'Operations and Service',
  'Treasury',
  'Payments',
  'Strategy',
];

const LEVELS_INR: Record<string, [number, number]> = {
  Executive: [300000, 600000],
  'Senior Executive': [500000, 1000000],
  'Assistant Manager': [800000, 1500000],
  'Deputy Manager': [1200000, 2000000],
  Manager: [1500000, 2800000],
  'Senior Manager': [2200000, 4000000],
  AVP: [3500000, 6000000],
  VP: [5000000, 9000000],
  SVP: [7000000, 14000000],
  EVP: [10000000, 25000000],
};

const JOB_FAMILIES = [
  'Banking Operations',
  'Technology',
  'Risk & Compliance',
  'Finance',
  'Marketing & Sales',
  'Human Resources',
  'Legal & Secretarial',
  'Treasury & Markets',
  'Debt Management',
  'Payments & Digital',
  'Strategy & Planning',
  'Customer Service',
];

async function main() {
  console.log('🌱 Enriching BFL tenant with missing PG data...\n');

  // Find BFL tenant
  const bflTenant =
    (await prisma.tenant.findFirst({
      where: { compportSchema: { not: null }, name: { contains: 'bfl', mode: 'insensitive' } },
    })) ??
    (await prisma.tenant.findFirst({
      where: { compportSchema: { not: null } },
    }));

  if (!bflTenant) {
    console.error('❌ No BFL tenant found');
    process.exit(1);
  }
  const T = bflTenant.id;
  console.log(`Tenant: ${bflTenant.name} (${T}), schema: ${bflTenant.compportSchema}`);
  await setRlsTenantContext(T);

  // Get existing employees (sample for seeding relationships)
  const allEmployees = await prisma.employee.findMany({
    where: { tenantId: T },
    select: {
      id: true,
      department: true,
      level: true,
      baseSalary: true,
      firstName: true,
      lastName: true,
    },
    take: 10000,
  });
  console.log(`Found ${allEmployees.length} employees to work with\n`);

  if (allEmployees.length === 0) {
    console.error('❌ No employees found');
    process.exit(1);
  }

  // Find an admin user for letters
  const adminUser =
    (await prisma.user.findFirst({
      where: { tenantId: T, role: { in: ['ADMIN', 'PLATFORM_ADMIN'] } },
    })) ?? (await prisma.user.findFirst({ where: { tenantId: T } }));

  // ═══ 1. UPDATE EMPLOYEE SALARIES ═════════════════════════
  console.log('1/10 Updating employee base salaries...');
  let updated = 0;
  for (let i = 0; i < allEmployees.length; i += 500) {
    const chunk = allEmployees.slice(i, i + 500);
    for (const emp of chunk) {
      if (Number(emp.baseSalary) > 0) continue; // Skip if already has salary
      const levelKey =
        Object.keys(LEVELS_INR).find((l) => emp.level?.includes(l)) ??
        pick(Object.keys(LEVELS_INR));
      const [min, max] = LEVELS_INR[levelKey]!;
      const salary = randInt(min, max);
      await prisma.employee.update({
        where: { id: emp.id },
        data: {
          baseSalary: salary,
          totalComp: Math.round(salary * randDec(1.1, 1.4)),
          totalCashComp: Math.round(salary * randDec(1.05, 1.25)),
          currency: 'INR',
          performanceRating: randDec(1.5, 5.0),
          compaRatio: randDec(0.75, 1.3),
          jobFamily: emp.department
            ? (JOB_FAMILIES.find((jf) =>
                jf.toLowerCase().includes(emp.department.toLowerCase().split(' ')[0]!),
              ) ?? pick(JOB_FAMILIES))
            : pick(JOB_FAMILIES),
        },
      });
      updated++;
    }
    process.stdout.write(`  ${Math.min(i + 500, allEmployees.length)}/${allEmployees.length}\r`);
  }
  console.log(`  ✅ ${updated} employees updated with salaries`);

  // ═══ 2. SALARY BANDS ═════════════════════════════════════
  console.log('2/10 Creating salary bands...');
  const existingBands = await prisma.salaryBand.count({ where: { tenantId: T } });
  if (existingBands > 0) {
    console.log(`  ⏭️ Already has ${existingBands} bands, skipping`);
  } else {
    const bandData = [];
    for (const jf of JOB_FAMILIES) {
      for (const [level, [min, max]] of Object.entries(LEVELS_INR)) {
        const p50 = Math.round((min + max) / 2);
        bandData.push({
          tenantId: T,
          jobFamily: jf,
          level,
          currency: 'INR',
          p10: Math.round(p50 * 0.65),
          p25: Math.round(p50 * 0.82),
          p50,
          p75: Math.round(p50 * 1.18),
          p90: Math.round(p50 * 1.4),
          source: 'Aon Radford India 2025',
          effectiveDate: new Date('2025-04-01'),
        });
      }
    }
    await prisma.salaryBand.createMany({ data: bandData as never, skipDuplicates: true });
    console.log(`  ✅ ${bandData.length} salary bands`);
  }

  // ═══ 3. MARKET DATA SOURCES ══════════════════════════════
  console.log('3/10 Creating market data sources...');
  const existingSources = await prisma.marketDataSource.count({ where: { tenantId: T } });
  if (existingSources > 0) {
    console.log(`  ⏭️ Already has ${existingSources} sources, skipping`);
  } else {
    await prisma.marketDataSource.createMany({
      data: [
        {
          tenantId: T,
          name: 'Aon Radford India Tech Survey 2025',
          provider: MarketDataProvider.RADFORD,
          config: { region: 'India', industry: 'BFSI & Technology' },
          surveyDate: new Date('2025-03-01'),
          ageingRate: 0.04,
          blendWeight: 35,
          status: 'ACTIVE',
        },
        {
          tenantId: T,
          name: 'Mercer India TRS 2025',
          provider: MarketDataProvider.MERCER,
          config: { region: 'India', industry: 'Financial Services' },
          surveyDate: new Date('2025-01-15'),
          ageingRate: 0.038,
          blendWeight: 30,
          status: 'ACTIVE',
        },
        {
          tenantId: T,
          name: 'Korn Ferry Hay India 2025',
          provider: MarketDataProvider.KORN_FERRY,
          config: { region: 'India', methodology: 'Hay Points' },
          surveyDate: new Date('2025-02-01'),
          ageingRate: 0.035,
          blendWeight: 20,
          status: 'ACTIVE',
        },
        {
          tenantId: T,
          name: 'Naukri Salary Insights 2025',
          provider: MarketDataProvider.CUSTOM,
          config: { region: 'India', source: 'Naukri.com' },
          surveyDate: new Date('2025-04-01'),
          ageingRate: 0.05,
          blendWeight: 15,
          status: 'ACTIVE',
        },
      ],
      skipDuplicates: true,
    });
    console.log('  ✅ 4 market data sources (Radford, Mercer, Korn Ferry, Naukri)');
  }

  // ═══ 4. COMP CYCLES + RECOMMENDATIONS ════════════════════
  console.log('4/10 Creating comp cycles...');
  const existingCycles = await prisma.compCycle.count({ where: { tenantId: T } });
  if (existingCycles > 0) {
    console.log(`  ⏭️ Already has ${existingCycles} cycles, skipping`);
  } else {
    const activeCycle = await prisma.compCycle.create({
      data: {
        tenantId: T,
        name: 'FY2026 Annual Merit & Bonus Review',
        cycleType: CycleType.COMBINED,
        status: CycleStatus.ACTIVE,
        budgetTotal: 8500000000,
        currency: 'INR',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2026-09-30'),
        settings: { meritBudgetPct: 10, bonusBudgetPct: 15 },
      },
    });
    await prisma.compCycle.create({
      data: {
        tenantId: T,
        name: 'FY2025 Annual Review',
        cycleType: CycleType.MERIT,
        status: CycleStatus.COMPLETED,
        budgetTotal: 7200000000,
        currency: 'INR',
        startDate: new Date('2025-04-01'),
        endDate: new Date('2025-09-30'),
        settings: {},
      },
    });

    // Budget per department
    for (const dept of DEPARTMENTS) {
      const deptEmps = allEmployees.filter((e) => e.department === dept).length || 100;
      await prisma.cycleBudget.create({
        data: {
          cycleId: activeCycle.id,
          department: dept,
          allocated: deptEmps * randInt(40000, 80000),
          spent: deptEmps * randInt(15000, 50000),
          remaining: deptEmps * randInt(10000, 40000),
        },
      });
    }

    // Recommendations for 3000 employees
    console.log('  Creating recommendations...');
    const recTypes = [
      RecommendationType.MERIT_INCREASE,
      RecommendationType.BONUS,
      RecommendationType.PROMOTION,
    ];
    const recStatuses = [
      RecommendationStatus.DRAFT,
      RecommendationStatus.SUBMITTED,
      RecommendationStatus.APPROVED,
      RecommendationStatus.REJECTED,
    ];
    const recBatch = [];
    for (let i = 0; i < Math.min(3000, allEmployees.length); i++) {
      const emp = allEmployees[i]!;
      const salary = Number(emp.baseSalary) || randInt(500000, 2000000);
      const pct = randDec(3, 18);
      recBatch.push({
        cycleId: activeCycle.id,
        employeeId: emp.id,
        recType: pick(recTypes),
        currentValue: salary,
        proposedValue: Math.round(salary * (1 + pct / 100)),
        justification: `Performance-based ${pct.toFixed(1)}% increase recommendation`,
        status: pick(recStatuses),
      });
    }
    for (let i = 0; i < recBatch.length; i += 500) {
      await prisma.compRecommendation.createMany({
        data: recBatch.slice(i, i + 500) as never,
        skipDuplicates: true,
      });
    }
    console.log(`  ✅ 2 cycles + ${recBatch.length} recommendations`);
  }

  // ═══ 5. RULES ════════════════════════════════════════════
  console.log('5/10 Creating rule sets...');
  const existingRules = await prisma.ruleSet.count({ where: { tenantId: T } });
  if (existingRules > 0) {
    console.log(`  ⏭️ Already has ${existingRules} rule sets, skipping`);
  } else {
    await prisma.ruleSet.create({
      data: {
        tenantId: T,
        name: 'BFL FY2026 Compensation Rules',
        description: 'Merit, bonus, LTI rules for FY2026',
        status: RuleSetStatus.ACTIVE,
        effectiveDate: new Date('2026-04-01'),
        rules: {
          create: [
            {
              name: 'Exceptional Performer Merit (4.5+)',
              ruleType: RuleType.MERIT,
              priority: 1,
              enabled: true,
              conditions: { performanceRating: { gte: 4.5 }, compaRatio: { lte: 1.15 } },
              actions: { meritIncreasePct: 15, minIncrease: 75000 },
              metadata: {},
            },
            {
              name: 'Strong Performer Merit (3.5-4.5)',
              ruleType: RuleType.MERIT,
              priority: 2,
              enabled: true,
              conditions: { performanceRating: { gte: 3.5, lt: 4.5 } },
              actions: { meritIncreasePct: 10 },
              metadata: {},
            },
            {
              name: 'Average Performer Merit (2.5-3.5)',
              ruleType: RuleType.MERIT,
              priority: 3,
              enabled: true,
              conditions: { performanceRating: { gte: 2.5, lt: 3.5 } },
              actions: { meritIncreasePct: 5 },
              metadata: {},
            },
            {
              name: 'Below Average (< 2.5)',
              ruleType: RuleType.MERIT,
              priority: 4,
              enabled: true,
              conditions: { performanceRating: { lt: 2.5 } },
              actions: { meritIncreasePct: 0, note: 'PIP recommended' },
              metadata: {},
            },
            {
              name: 'Annual Bonus Payout',
              ruleType: RuleType.BONUS,
              priority: 1,
              enabled: true,
              conditions: { performanceRating: { gte: 3.0 }, tenure: { gte: 6 } },
              actions: { bonusPct: 12, maxBonus: 2500000 },
              metadata: {},
            },
            {
              name: 'Salary Cap - Senior Leadership',
              ruleType: RuleType.CAP,
              priority: 10,
              enabled: true,
              conditions: {},
              actions: { maxSalary: 30000000, maxIncreasePct: 25 },
              metadata: {},
            },
            {
              name: 'Minimum Salary Floor',
              ruleType: RuleType.FLOOR,
              priority: 11,
              enabled: true,
              conditions: {},
              actions: { minSalary: 280000, minIncreasePct: 3 },
              metadata: {},
            },
            {
              name: 'LTI for VP & Above',
              ruleType: RuleType.LTI,
              priority: 5,
              enabled: true,
              conditions: {
                level: { in: ['VP', 'SVP', 'EVP', 'AVP'] },
                performanceRating: { gte: 3.5 },
              },
              actions: { ltiMultiplier: 0.25, vestingMonths: 48 },
              metadata: {},
            },
            {
              name: 'Probation Eligibility (6 months)',
              ruleType: RuleType.ELIGIBILITY,
              priority: 0,
              enabled: true,
              conditions: { tenureMonths: { gte: 6 } },
              actions: { eligible: true },
              metadata: {},
            },
            {
              name: 'Proration - Mid-Year Joiners',
              ruleType: RuleType.PRORATION,
              priority: 6,
              enabled: true,
              conditions: { joinedAfter: '2025-10-01' },
              actions: { prorationFactor: 0.5 },
              metadata: {},
            },
          ],
        },
      },
    });
    console.log('  ✅ 1 rule set with 10 rules');
  }

  // ═══ 6. PAYROLL ══════════════════════════════════════════
  console.log('6/10 Creating payroll runs...');
  const existingPayroll = await prisma.payrollRun.count({ where: { tenantId: T } });
  if (existingPayroll > 0) {
    console.log(`  ⏭️ Already has ${existingPayroll} runs, skipping`);
  } else {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04'];
    for (const period of months) {
      const run = await prisma.payrollRun.create({
        data: {
          tenantId: T,
          period,
          status: period === '2026-04' ? PayrollStatus.REVIEW : PayrollStatus.FINALIZED,
          totalGross: randInt(9000000000, 12000000000),
          totalNet: randInt(6500000000, 9000000000),
          employeeCount: allEmployees.length,
        },
      });

      // Line items for 300 employees per run
      const lineItems = [];
      for (let i = 0; i < Math.min(300, allEmployees.length); i++) {
        const emp = allEmployees[i]!;
        const monthly = Math.round((Number(emp.baseSalary) || 500000) / 12);
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
          {
            payrollRunId: run.id,
            employeeId: emp.id,
            component: 'PF Contribution',
            amount: Math.round(monthly * 0.12),
            previousAmount: Math.round(monthly * 0.12),
            delta: 0,
          },
        );
      }
      for (let i = 0; i < lineItems.length; i += 500) {
        await prisma.payrollLineItem.createMany({
          data: lineItems.slice(i, i + 500) as never,
          skipDuplicates: true,
        });
      }

      // Anomalies
      const anomalies = [];
      const anomalyTypes = [
        AnomalyType.SPIKE,
        AnomalyType.DROP,
        AnomalyType.UNUSUAL_DEDUCTION,
        AnomalyType.MISSING_COMPONENT,
        AnomalyType.NEGATIVE_NET,
      ];
      const severities = [
        AnomalySeverity.CRITICAL,
        AnomalySeverity.HIGH,
        AnomalySeverity.MEDIUM,
        AnomalySeverity.LOW,
      ];
      for (let i = 0; i < 20; i++) {
        const emp = allEmployees[randInt(0, Math.min(500, allEmployees.length - 1))]!;
        anomalies.push({
          payrollRunId: run.id,
          employeeId: emp.id,
          anomalyType: pick(anomalyTypes),
          severity: pick(severities),
          details: {
            message: 'Unusual variance detected in salary component',
            delta: randInt(-100000, 200000),
            component: pick(['Basic', 'HRA', 'Special Allowance', 'PF']),
          },
        });
      }
      await prisma.payrollAnomaly.createMany({ data: anomalies as never, skipDuplicates: true });
    }
    console.log('  ✅ 4 payroll runs with line items + 80 anomalies');
  }

  // ═══ 7. BENEFITS ═════════════════════════════════════════
  console.log('7/10 Creating benefit plans...');
  const existingPlans = await prisma.benefitPlan.count({ where: { tenantId: T } });
  if (existingPlans > 0) {
    console.log(`  ⏭️ Already has ${existingPlans} plans, skipping`);
  } else {
    const plans = [
      {
        planType: BenefitPlanType.MEDICAL,
        name: 'Group Mediclaim Policy',
        carrier: 'Star Health',
        premiums: { employee: 3000, employer: 9000 },
        description: 'Group health insurance - ₹5L coverage',
      },
      {
        planType: BenefitPlanType.DENTAL,
        name: 'Dental Cover',
        carrier: 'ICICI Lombard',
        premiums: { employee: 500, employer: 1500 },
        description: 'Dental treatment coverage',
      },
      {
        planType: BenefitPlanType.LIFE,
        name: 'Group Term Life - 3x CTC',
        carrier: 'HDFC Life',
        premiums: { employee: 0, employer: 4000 },
        description: 'Term life insurance - 3x annual CTC',
      },
      {
        planType: BenefitPlanType.DISABILITY,
        name: 'Accident & Disability',
        carrier: 'Tata AIG',
        premiums: { employee: 400, employer: 1600 },
        description: 'Personal accident + disability cover',
      },
      {
        planType: BenefitPlanType.VISION,
        name: 'Vision Care',
        carrier: 'Manipal Cigna',
        premiums: { employee: 200, employer: 800 },
        description: 'Annual eye check-up + spectacle allowance',
      },
    ];
    const createdPlans = [];
    for (const plan of plans) {
      const p = await prisma.benefitPlan.create({
        data: {
          tenantId: T,
          planType: plan.planType,
          name: plan.name,
          carrier: plan.carrier,
          premiums: plan.premiums,
          effectiveDate: new Date('2026-01-01'),
          description: plan.description,
          deductibles: {},
          outOfPocketMax: {},
          copays: {},
          coverageDetails: {},
        },
      });
      createdPlans.push(p);
    }

    // Enroll 5000 employees
    const tiers = [BenefitTier.EMPLOYEE, BenefitTier.EMPLOYEE_SPOUSE, BenefitTier.FAMILY];
    const enrollments = [];
    for (let i = 0; i < Math.min(5000, allEmployees.length); i++) {
      const emp = allEmployees[i]!;
      const plan = pick(createdPlans);
      enrollments.push({
        tenantId: T,
        employeeId: emp.id,
        planId: plan.id,
        tier: pick(tiers),
        status: EnrollmentStatus.ACTIVE,
        effectiveDate: new Date('2026-01-01'),
        employeePremium: randInt(500, 4000),
        employerPremium: randInt(2000, 10000),
        metadata: {},
      });
    }
    for (let i = 0; i < enrollments.length; i += 500) {
      await prisma.benefitEnrollment.createMany({
        data: enrollments.slice(i, i + 500) as never,
        skipDuplicates: true,
      });
    }
    console.log(`  ✅ 5 plans + ${enrollments.length} enrollments`);
  }

  // ═══ 8. EQUITY ═══════════════════════════════════════════
  console.log('8/10 Creating equity plans...');
  const existingEquity = await prisma.equityPlan.count({ where: { tenantId: T } });
  if (existingEquity > 0) {
    console.log(`  ⏭️ Already has ${existingEquity} plans, skipping`);
  } else {
    const plan = await prisma.equityPlan.create({
      data: {
        tenantId: T,
        name: 'BFL ESOP 2025',
        planType: EquityGrantType.RSU,
        totalSharesAuthorized: 5000000,
        sharesIssued: 1200000,
        sharesAvailable: 3800000,
        sharePrice: 1650.0,
        currency: 'INR',
        effectiveDate: new Date('2025-01-01'),
        description: 'Employee Stock Ownership Plan - BFL',
      },
    });

    // Grants for senior employees
    const seniorEmps = allEmployees
      .filter(
        (e) =>
          e.level &&
          ['VP', 'SVP', 'EVP', 'AVP', 'Senior Manager', 'Manager'].some((l) =>
            e.level!.includes(l),
          ),
      )
      .slice(0, 800);
    const grants = [];
    for (const emp of seniorEmps) {
      const shares = randInt(50, 3000);
      grants.push({
        tenantId: T,
        employeeId: emp.id,
        planId: plan.id,
        grantType: EquityGrantType.RSU,
        grantDate: randDate(new Date('2025-01-01'), new Date('2026-03-01')),
        totalShares: shares,
        vestedShares: Math.floor(shares * randDec(0, 0.4)),
        grantPrice: 1650.0,
        currentPrice: randDec(1500, 1900),
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
    console.log(`  ✅ 1 ESOP plan + ${grants.length} grants`);
  }

  // ═══ 9. ATTRITION RISK ══════════════════════════════════
  console.log('9/10 Creating attrition risk scores...');
  const existingRisk = await prisma.attritionRiskScore.count({ where: { tenantId: T } });
  if (existingRisk > 0) {
    console.log(`  ⏭️ Already has ${existingRisk} scores, skipping`);
  } else {
    const riskBatch = [];
    // Score 5000 employees
    const riskLevels = [
      AttritionRiskLevel.LOW,
      AttritionRiskLevel.LOW,
      AttritionRiskLevel.LOW,
      AttritionRiskLevel.MEDIUM,
      AttritionRiskLevel.HIGH,
      AttritionRiskLevel.CRITICAL,
    ];
    for (let i = 0; i < Math.min(5000, allEmployees.length); i++) {
      const emp = allEmployees[i]!;
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
          tenureYears: randDec(0.5, 20),
          compaRatio: randDec(0.7, 1.3),
          lastPromotionMonths: randInt(6, 72),
          managerRating: randDec(2, 5),
          marketDemand: pick(['LOW', 'MEDIUM', 'HIGH']),
          department: emp.department,
          level: emp.level,
        },
        recommendation:
          riskLevel === 'HIGH' || riskLevel === 'CRITICAL'
            ? `Retention risk: consider ${randInt(5, 20)}% salary adjustment + career development plan`
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
  }

  // ═══ 10. LETTERS ═════════════════════════════════════════
  console.log('10/10 Creating compensation letters...');
  const existingLetters = await prisma.compensationLetter.count({ where: { tenantId: T } });
  if (existingLetters > 0) {
    console.log(`  ⏭️ Already has ${existingLetters} letters, skipping`);
  } else if (!adminUser) {
    console.log('  ⏭️ No admin user found, skipping letters');
  } else {
    const letterTypes = [
      LetterType.RAISE,
      LetterType.PROMOTION,
      LetterType.BONUS,
      LetterType.TOTAL_COMP_SUMMARY,
    ];
    const letterBatch = [];
    for (let i = 0; i < Math.min(200, allEmployees.length); i++) {
      const emp = allEmployees[i]!;
      const salary = Number(emp.baseSalary) || 500000;
      const lt = pick(letterTypes);
      letterBatch.push({
        tenantId: T,
        userId: adminUser.id,
        employeeId: emp.id,
        letterType: lt,
        status: pick([
          LetterStatus.DRAFT,
          LetterStatus.REVIEW,
          LetterStatus.APPROVED,
          LetterStatus.SENT,
        ]),
        subject: `${lt.replace(/_/g, ' ')} Letter - ${emp.firstName} ${emp.lastName}`,
        content: `Dear ${emp.firstName},\n\nWe are pleased to inform you about your compensation update for FY2026.\n\nYour revised annual CTC: ₹${Math.round(salary * 1.1).toLocaleString('en-IN')}\n\nThis reflects our commitment to recognizing your contributions.\n\nBest regards,\nHR Team\nBFL`,
        compData: {
          currentSalary: salary,
          newSalary: Math.round(salary * 1.1),
          increasePct: 10,
          department: emp.department,
        },
        tone: 'professional',
        language: 'en',
        metadata: {},
      });
    }
    for (let i = 0; i < letterBatch.length; i += 100) {
      await prisma.compensationLetter.createMany({
        data: letterBatch.slice(i, i + 100) as never,
        skipDuplicates: true,
      });
    }
    console.log(`  ✅ ${letterBatch.length} letters`);
  }

  // ═══ SUMMARY ═════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('✅ BFL enrichment complete!');
  console.log('══════════════════════════════════════════');
  console.log(`Tenant:            ${bflTenant.name}`);
  console.log(`Employees updated: ${updated} (with salaries + ratings)`);
  console.log('Salary Bands:      120 (12 families × 10 levels)');
  console.log('Market Sources:    4 (Radford, Mercer, KF, Naukri)');
  console.log('Comp Cycles:       2 + 3000 recommendations');
  console.log('Rule Sets:         1 (10 rules)');
  console.log('Payroll Runs:      4 (with line items + anomalies)');
  console.log('Benefit Plans:     5 + 5000 enrollments');
  console.log('Equity Grants:     ~800');
  console.log('Attrition Risks:   5000');
  console.log('Letters:           200');
  console.log('══════════════════════════════════════════\n');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
