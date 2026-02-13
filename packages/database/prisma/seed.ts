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

  // ─────────────────────────────────────────────────────────────
  // 6. Compensation Cycles
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
      budgetTotal: 500000,
      currency: 'USD',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-03-31'),
      settings: { guidelinePct: 3.5, maxPct: 8, minPct: 0 },
    },
  });

  // Cycle Budgets for merit cycle
  const departments = ['Engineering', 'Sales', 'HR'];
  const deptBudgets: Record<string, number> = { Engineering: 250000, Sales: 150000, HR: 100000 };
  for (const dept of departments) {
    const lead = createdEmployees.find(
      e => e.dept === dept && (e.code.endsWith('-004') || e.code.endsWith('-001')),
    );
    await prisma.cycleBudget.upsert({
      where: { id: `seed-budget-${dept.toLowerCase()}` },
      update: {},
      create: {
        id: `seed-budget-${dept.toLowerCase()}`,
        cycleId: meritCycle.id,
        department: dept,
        managerId: lead?.id ?? null,
        allocated: deptBudgets[dept]!,
        spent: Math.round(deptBudgets[dept]! * 0.6),
        remaining: Math.round(deptBudgets[dept]! * 0.4),
        driftPct: 1.2,
      },
    });
  }
  console.log('  ✅ Cycle Budgets: 3 departments');

  // ─────────────────────────────────────────────────────────────
  // 7. Compensation Recommendations (one per employee in merit cycle)
  // ─────────────────────────────────────────────────────────────
  const increasePcts = [3.5, 4.0, 2.5, 5.0, 3.0, 3.5, 2.0, 4.5, 3.0, 2.5];
  const recStatuses: RecommendationStatus[] = [
    RecommendationStatus.APPROVED,
    RecommendationStatus.SUBMITTED,
    RecommendationStatus.DRAFT,
    RecommendationStatus.APPROVED,
    RecommendationStatus.SUBMITTED,
    RecommendationStatus.DRAFT,
    RecommendationStatus.APPROVED,
    RecommendationStatus.SUBMITTED,
    RecommendationStatus.APPROVED,
    RecommendationStatus.DRAFT,
  ];
  const salaries = [150000, 120000, 90000, 175000, 130000, 100000, 80000, 125000, 105000, 85000];

  for (let i = 0; i < createdEmployees.length; i++) {
    const emp = createdEmployees[i]!;
    const pct = increasePcts[i]!;
    const currentSalary = salaries[i]!;
    const proposedSalary = Math.round(currentSalary * (1 + pct / 100));
    await prisma.compRecommendation.upsert({
      where: { id: `seed-rec-${emp.code}` },
      update: {},
      create: {
        id: `seed-rec-${emp.code}`,
        cycleId: meritCycle.id,
        employeeId: emp.id,
        recType: RecommendationType.MERIT_INCREASE,
        currentValue: currentSalary,
        proposedValue: proposedSalary,
        justification: `${pct}% merit increase based on performance review and market data.`,
        status: recStatuses[i]!,
        approverUserId: recStatuses[i] === RecommendationStatus.APPROVED ? admin.id : null,
        approvedAt: recStatuses[i] === RecommendationStatus.APPROVED ? new Date('2026-02-01') : null,
      },
    });
  }
  console.log(`  ✅ Recommendations: ${createdEmployees.length} created`);

  const bonusCycle = await prisma.compCycle.upsert({
    where: { id: 'seed-cycle-bonus-q4' },
    update: {},
    create: {
      id: 'seed-cycle-bonus-q4',
      tenantId: tenant.id,
      name: '2025 Q4 Bonus',
      cycleType: CycleType.BONUS,
      status: CycleStatus.COMPLETED,
      budgetTotal: 250000,
      currency: 'USD',
      startDate: new Date('2025-10-01'),
      endDate: new Date('2025-12-31'),
      settings: { targetPct: 10, maxPct: 20 },
    },
  });
  console.log(`  ✅ Comp Cycles: ${meritCycle.name}, ${bonusCycle.name}`);

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
  console.log(`  ✅ Rule Sets: ${meritRuleSet.name} (3 rules), ${bonusRuleSet.name} (2 rules)`);

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
      coverageDetails: { preventive: '100%', basic: '80%', major: '50%', orthodontia: '50% child only' },
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
      coverageDetails: { examFrequency: 'annual', lensAllowance: 150, frameAllowance: 200, contactAllowance: 150 },
      effectiveDate: new Date('2026-01-01'),
      isActive: true,
    },
  });
  console.log(`  ✅ Benefit Plans: ${healthPlan.name}, ${dentalPlan.name}, ${visionPlan.name}`);

  // Benefit Enrollments — enroll employees in plans
  const plans = [healthPlan, dentalPlan, visionPlan];
  const tiers: BenefitTier[] = [
    BenefitTier.FAMILY, BenefitTier.EMPLOYEE_SPOUSE, BenefitTier.EMPLOYEE,
    BenefitTier.FAMILY, BenefitTier.EMPLOYEE, BenefitTier.EMPLOYEE_SPOUSE,
    BenefitTier.EMPLOYEE, BenefitTier.FAMILY, BenefitTier.EMPLOYEE_SPOUSE,
    BenefitTier.EMPLOYEE,
  ];
  const empPremiums: Record<string, number[]> = {
    [healthPlan.id]: [500, 350, 150, 500, 150, 350, 150, 500, 350, 150],
    [dentalPlan.id]: [90, 60, 30, 90, 30, 60, 30, 90, 60, 30],
    [visionPlan.id]: [40, 30, 15, 40, 15, 30, 15, 40, 30, 15],
  };

  let enrollmentCount = 0;
  for (const plan of plans) {
    for (let i = 0; i < createdEmployees.length; i++) {
      const emp = createdEmployees[i]!;
      const enrollId = `seed-enroll-${emp.code}-${plan.id.replace('seed-plan-', '')}`;
      await prisma.benefitEnrollment.upsert({
        where: { id: enrollId },
        update: {},
        create: {
          id: enrollId,
          tenantId: tenant.id,
          employeeId: emp.id,
          planId: plan.id,
          tier: tiers[i]!,
          status: EnrollmentStatus.ACTIVE,
          effectiveDate: new Date('2026-01-01'),
          employeePremium: empPremiums[plan.id]![i]!,
          employerPremium: Math.round(empPremiums[plan.id]![i]! * 0.7),
          electedAt: new Date('2025-11-15'),
          metadata: { enrollmentPeriod: '2026 Open Enrollment' },
        },
      });
      enrollmentCount++;
    }
  }
  console.log(`  ✅ Benefit Enrollments: ${enrollmentCount} created`);

  // ─────────────────────────────────────────────────────────────
  // 10. Payroll Runs with Line Items
  // ─────────────────────────────────────────────────────────────
  const payrollPeriods = [
    { id: 'seed-payroll-jan-2026', period: '2026-01', status: PayrollStatus.FINALIZED },
    { id: 'seed-payroll-feb-2026', period: '2026-02', status: PayrollStatus.REVIEW },
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
      const monthlySalary = Math.round(salaries[i]! / 12);
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
  console.log('  ✅ Payroll Runs: January 2026 (finalized), February 2026 (review)');

  // Add a payroll anomaly on the Feb run for one employee
  await prisma.payrollAnomaly.upsert({
    where: { id: 'seed-anomaly-1' },
    update: {},
    create: {
      id: 'seed-anomaly-1',
      payrollRunId: 'seed-payroll-feb-2026',
      employeeId: createdEmployees[2]!.id,
      anomalyType: AnomalyType.SPIKE,
      severity: AnomalySeverity.MEDIUM,
      details: {
        description: 'Base salary component increased 15% vs prior period',
        previousAmount: 7500,
        currentAmount: 8625,
        changePct: 15,
      },
      resolved: false,
    },
  });
  console.log('  ✅ Payroll Anomaly: 1 flagged');

  // ─────────────────────────────────────────────────────────────
  // 11. Compliance Scan with Findings
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
        warning: 2,
        info: 1,
        totalFindings: 3,
        topRisks: ['Pay equity gap in Engineering', 'Missing overtime classification'],
      },
      scanConfig: { scope: 'full', includePayEquity: true, includeFLSA: true },
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
      description: 'Female engineers at the Mid level earn 4.2% less than male counterparts on average.',
      explanation: 'Analysis of base salary data shows a statistically significant gap at the Mid level in Engineering.',
      remediation: 'Review and adjust compensation for affected employees during the current merit cycle.',
      affectedScope: { department: 'Engineering', level: 'Mid', affectedCount: 2 },
      metadata: { gapPct: 4.2, confidence: 0.87 },
    },
    {
      id: 'seed-finding-2',
      category: ComplianceFindingCategory.FLSA_OVERTIME,
      severity: ComplianceFindingSeverity.WARNING,
      title: 'Missing FLSA overtime classification',
      description: 'Three Junior-level employees may be misclassified as exempt from overtime.',
      explanation: 'Employees earning below the FLSA salary threshold should be classified as non-exempt.',
      remediation: 'Review classification for Junior employees and update payroll records accordingly.',
      affectedScope: { level: 'Junior', affectedCount: 3 },
      metadata: { threshold: 35568, currentMinSalary: 80000 },
    },
    {
      id: 'seed-finding-3',
      category: ComplianceFindingCategory.DATA_QUALITY,
      severity: ComplianceFindingSeverity.INFO,
      title: 'Uniform hire dates detected',
      description: 'All employees share the same hire date (2023-01-15), which may indicate imported seed data.',
      explanation: 'Identical hire dates across all employees is unusual and may affect tenure-based calculations.',
      remediation: 'Verify hire dates are accurate or update with correct dates from HRIS.',
      affectedScope: { affectedCount: 10 },
      metadata: { commonDate: '2023-01-15' },
    },
  ];

  for (const finding of findings) {
    await prisma.complianceFinding.upsert({
      where: { id: finding.id },
      update: {},
      create: { ...finding, scanId: complianceScan.id, resolved: false },
    });
  }
  console.log(`  ✅ Compliance Scan: score ${complianceScan.overallScore}, 3 findings`);

  // ─────────────────────────────────────────────────────────────
  // 12. Additional Notifications
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
      title: 'Payroll Anomaly Detected',
      body: 'A salary spike was detected for Dave Davis in the February 2026 payroll run.',
      metadata: { category: 'payroll', anomalyId: 'seed-anomaly-1' },
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
      body: 'Your compliance scan scored 82/100. 2 warnings require attention.',
      metadata: { category: 'compliance', scanId: complianceScan.id },
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
  console.log(`  ✅ Notifications: ${additionalNotifications.length + 1} total (including welcome)`);

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

