import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import type {
  EmployeeData,
  RuleCondition,
  RuleAction,
  RuleType,
} from '@compensation/shared';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface TestCaseData {
  id: string;
  ruleSetId: string;
  name: string;
  input: EmployeeData;
  expectedOutput: ExpectedOutput;
}

export interface ExpectedOutput {
  shouldApplyRules: string[];
  shouldSkipRules: string[];
  blocked: boolean;
  meritRange?: { min: number; max: number };
  bonusRange?: { min: number; max: number };
  ltiRange?: { min: number; max: number };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function setFieldForOperator(
  emp: EmployeeData,
  field: string,
  operator: string,
  value: unknown,
  invert: boolean,
): void {
  const rec = emp as Record<string, unknown>;
  if (!invert) {
    switch (operator) {
      case 'eq': rec[field] = value; break;
      case 'neq': rec[field] = typeof value === 'string' ? `not-${value}` : -9999; break;
      case 'gt': case 'gte': rec[field] = Number(value) + 1; break;
      case 'lt': case 'lte': rec[field] = Number(value) - 1; break;
      case 'in': if (Array.isArray(value) && value.length > 0) rec[field] = value[0]; break;
      case 'notIn': rec[field] = '__not_in_list__'; break;
      case 'between': if (Array.isArray(value) && value.length === 2) rec[field] = (Number(value[0]) + Number(value[1])) / 2; break;
      case 'contains': rec[field] = `prefix-${String(value)}-suffix`; break;
      case 'startsWith': rec[field] = `${String(value)}-rest`; break;
      case 'matches': rec[field] = String(value).replace(/[.*+?^${}()|[\]\\]/g, ''); break;
    }
  } else {
    switch (operator) {
      case 'eq': rec[field] = typeof value === 'string' ? `wrong-${value}` : -99999; break;
      case 'neq': rec[field] = value; break;
      case 'gt': case 'gte': rec[field] = Number(value) - 100; break;
      case 'lt': case 'lte': rec[field] = Number(value) + 100; break;
      case 'in': rec[field] = '__not_in_list__'; break;
      case 'notIn': if (Array.isArray(value) && value.length > 0) rec[field] = value[0]; break;
      case 'between': if (Array.isArray(value) && value.length === 2) rec[field] = Number(value[1]) + 1000; break;
      default: rec[field] = '__invalid__'; break;
    }
  }
}

function buildMatchingEmployee(conditions: RuleCondition[], idx: number): EmployeeData {
  const emp: EmployeeData = {
    id: `test-emp-${idx}`,
    employeeCode: `TC-${idx.toString().padStart(4, '0')}`,
    department: 'Engineering',
    level: 'L4',
    baseSalary: 100000,
    hireDate: new Date('2020-01-15'),
  };
  for (const c of conditions) setFieldForOperator(emp, c.field, c.operator, c.value, false);
  return emp;
}

function buildFailingEmployee(conditions: RuleCondition[], failIdx: number, idx: number): EmployeeData {
  const emp = buildMatchingEmployee(conditions, idx);
  emp.id = `test-emp-fail-${idx}-${failIdx}`;
  emp.employeeCode = `TC-FAIL-${idx}-${failIdx}`;
  const cond = conditions[failIdx];
  if (cond) setFieldForOperator(emp, cond.field, cond.operator, cond.value, true);
  return emp;
}

function expectedRangeFromActions(
  actions: RuleAction[],
  baseSalary: number,
): { meritRange?: { min: number; max: number }; bonusRange?: { min: number; max: number }; ltiRange?: { min: number; max: number } } {
  const result: ReturnType<typeof expectedRangeFromActions> = {};
  for (const action of actions) {
    const pct = Number(action.params['percentage'] ?? 0);
    const amount = Number(action.params['amount'] ?? 0);
    const computed = pct > 0 ? (baseSalary * pct) / 100 : amount;
    if (computed <= 0) continue;
    switch (action.type) {
      case 'setMerit': result.meritRange = { min: computed * 0.9, max: computed * 1.1 }; break;
      case 'setBonus': result.bonusRange = { min: computed * 0.9, max: computed * 1.1 }; break;
      case 'setLTI': result.ltiRange = { min: computed * 0.9, max: computed * 1.1 }; break;
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class TestGeneratorService {
  private readonly logger = new Logger(TestGeneratorService.name);

  constructor(private readonly db: DatabaseService) {}

  async generateTestCases(tenantId: string, ruleSetId: string): Promise<TestCaseData[]> {
    const dbRuleSet = await this.db.client.ruleSet.findFirst({
      where: { id: ruleSetId, tenantId },
      include: { rules: true },
    });
    if (!dbRuleSet) {
      throw new NotFoundException(`RuleSet ${ruleSetId} not found`);
    }

    const testCases: TestCaseData[] = [];
    let idx = 0;

    for (const rule of dbRuleSet.rules) {
      const conditions = (Array.isArray(rule.conditions) ? rule.conditions : []) as unknown as RuleCondition[];
      const actions = (Array.isArray(rule.actions) ? rule.actions : []) as unknown as RuleAction[];
      const ruleType = rule.ruleType as RuleType;
      const isBlock = actions.some((a) => a.type === 'block');

      // 1. Matching employee — rule should apply
      const matchEmp = buildMatchingEmployee(conditions, idx++);
      const ranges = expectedRangeFromActions(actions, matchEmp.baseSalary);
      testCases.push(await this.saveTestCase(ruleSetId, {
        name: `${rule.name} — should apply when all conditions match`,
        input: matchEmp,
        expectedOutput: { shouldApplyRules: [rule.id], shouldSkipRules: [], blocked: isBlock, ...ranges },
      }));

      // 2. Failing employee — one condition fails (up to 2)
      for (let j = 0; j < Math.min(conditions.length, 2); j++) {
        const failEmp = buildFailingEmployee(conditions, j, idx++);
        testCases.push(await this.saveTestCase(ruleSetId, {
          name: `${rule.name} — should NOT apply when ${conditions[j]!.field} fails`,
          input: failEmp,
          expectedOutput: { shouldApplyRules: [], shouldSkipRules: [rule.id], blocked: false },
        }));
      }

      // 3. Cap/floor boundary tests
      if (ruleType === 'CAP' || ruleType === 'FLOOR') {
        const boundaryEmp = buildMatchingEmployee(conditions, idx++);
        const capAmt = Number(actions[0]?.params['amount'] ?? actions[0]?.params['percentage'] ?? 0);
        if (capAmt > 0) {
          boundaryEmp.baseSalary = capAmt;
          testCases.push(await this.saveTestCase(ruleSetId, {
            name: `${rule.name} — boundary test at cap/floor value`,
            input: boundaryEmp,
            expectedOutput: { shouldApplyRules: [rule.id], shouldSkipRules: [], blocked: false },
          }));
        }
      }

      // 4. Proration edge cases
      if (ruleType === 'MERIT' || ruleType === 'BONUS' || ruleType === 'PRORATION') {
        const newHire = buildMatchingEmployee(conditions, idx++);
        newHire.hireDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        testCases.push(await this.saveTestCase(ruleSetId, {
          name: `${rule.name} — proration: new hire (90 days)`,
          input: newHire,
          expectedOutput: { shouldApplyRules: [rule.id], shouldSkipRules: [], blocked: false },
        }));

        const termEmp = buildMatchingEmployee(conditions, idx++);
        termEmp.terminationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        testCases.push(await this.saveTestCase(ruleSetId, {
          name: `${rule.name} — proration: mid-year termination`,
          input: termEmp,
          expectedOutput: { shouldApplyRules: [rule.id], shouldSkipRules: [], blocked: false },
        }));
      }

      // 5. Block scenario
      if (isBlock) {
        const blockEmp = buildMatchingEmployee(conditions, idx++);
        testCases.push(await this.saveTestCase(ruleSetId, {
          name: `${rule.name} — block: employee should be blocked`,
          input: blockEmp,
          expectedOutput: { shouldApplyRules: [rule.id], shouldSkipRules: [], blocked: true },
        }));
      }
    }

    // 6. Priority conflict test
    if (dbRuleSet.rules.length >= 2) {
      const r1 = dbRuleSet.rules[0]!;
      const r2 = dbRuleSet.rules[1]!;
      const combined = [
        ...((Array.isArray(r1.conditions) ? r1.conditions : []) as unknown as RuleCondition[]),
        ...((Array.isArray(r2.conditions) ? r2.conditions : []) as unknown as RuleCondition[]),
      ];
      const conflictEmp = buildMatchingEmployee(combined, idx++);
      testCases.push(await this.saveTestCase(ruleSetId, {
        name: `Priority conflict — "${r1.name}" and "${r2.name}" both match`,
        input: conflictEmp,
        expectedOutput: { shouldApplyRules: [r1.id, r2.id], shouldSkipRules: [], blocked: false },
      }));
    }

    this.logger.log(`Generated ${testCases.length} test cases for RuleSet ${ruleSetId}`);
    return testCases;
  }

  private async saveTestCase(
    ruleSetId: string,
    data: { name: string; input: EmployeeData; expectedOutput: ExpectedOutput },
  ): Promise<TestCaseData> {
    const record = await this.db.client.testCase.create({
      data: {
        ruleSetId,
        name: data.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: data.input as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expectedOutput: data.expectedOutput as any,
      },
    });
    return {
      id: record.id,
      ruleSetId: record.ruleSetId,
      name: record.name,
      input: data.input,
      expectedOutput: data.expectedOutput,
    };
  }
}

