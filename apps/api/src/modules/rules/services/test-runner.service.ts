import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import {
  evaluateRules,
  type EmployeeData,
  type RuleCondition,
  type RuleAction,
  type RuleSet,
  type RuleEvaluationResult,
} from '@compensation/shared';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface TestCaseResult {
  testCaseId: string;
  name: string;
  passed: boolean;
  details: {
    expectedApplied: string[];
    actualApplied: string[];
    expectedSkipped: string[];
    actualSkipped: string[];
    expectedBlocked: boolean;
    actualBlocked: boolean;
    meritInRange: boolean | null;
    bonusInRange: boolean | null;
    ltiInRange: boolean | null;
    mismatches: string[];
  };
}

export interface TestRunReport {
  ruleSetId: string;
  total: number;
  passed: number;
  failed: number;
  results: TestCaseResult[];
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class TestRunnerService {
  private readonly logger = new Logger(TestRunnerService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * List test cases for a rule set with simple pagination.
   */
  async listTestCases(
    ruleSetId: string,
    page: number,
    limit: number,
  ): Promise<{ data: unknown[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.db.client.testCase.findMany({
        where: { ruleSetId },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.db.client.testCase.count({ where: { ruleSetId } }),
    ]);
    return { data, total, page, limit };
  }

  async runTestCases(tenantId: string, ruleSetId: string): Promise<TestRunReport> {
    // Load RuleSet with rules
    const dbRuleSet = await this.db.client.ruleSet.findFirst({
      where: { id: ruleSetId, tenantId },
      include: { rules: true },
    });
    if (!dbRuleSet) {
      throw new NotFoundException(`RuleSet ${ruleSetId} not found`);
    }

    // Build engine RuleSet
    const ruleSet: RuleSet = {
      id: dbRuleSet.id,
      name: dbRuleSet.name,
      effectiveDate: dbRuleSet.effectiveDate ?? undefined,
      rules: dbRuleSet.rules.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.ruleType as RuleSet['rules'][number]['type'],
        priority: r.priority,
        conditions: (Array.isArray(r.conditions) ? r.conditions : []) as unknown as RuleCondition[],
        actions: (Array.isArray(r.actions) ? r.actions : []) as unknown as RuleAction[],
        enabled: r.enabled,
      })),
    };

    // Load all test cases for this rule set
    const testCases = await this.db.client.testCase.findMany({
      where: { ruleSetId },
      orderBy: { createdAt: 'asc' },
    });

    const results: TestCaseResult[] = [];

    for (const tc of testCases) {
      const input = tc.input as unknown as EmployeeData;
      const expected = tc.expectedOutput as Record<string, unknown>;

      // Run evaluation
      const evalResult: RuleEvaluationResult = evaluateRules(input, ruleSet);

      // Compare results
      const result = this.compareResults(tc.id, tc.name, evalResult, expected);
      results.push(result);

      // Update test case record
      await this.db.client.testCase.update({
        where: { id: tc.id },
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actualOutput: evalResult as any,
          passed: result.passed,
        },
      });
    }

    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;

    this.logger.log(`Test run for RuleSet ${ruleSetId}: ${passed}/${results.length} passed`);

    return {
      ruleSetId,
      total: results.length,
      passed,
      failed,
      results,
    };
  }

  private compareResults(
    testCaseId: string,
    name: string,
    actual: RuleEvaluationResult,
    expected: Record<string, unknown>,
  ): TestCaseResult {
    const mismatches: string[] = [];

    const expectedApplied = (expected['shouldApplyRules'] as string[]) ?? [];
    const expectedSkipped = (expected['shouldSkipRules'] as string[]) ?? [];
    const expectedBlocked = Boolean(expected['blocked']);

    // Check applied rules
    const appliedMatch = expectedApplied.every((id) => actual.appliedRules.includes(id));
    if (!appliedMatch) {
      mismatches.push(`Expected rules [${expectedApplied.join(', ')}] to apply, got [${actual.appliedRules.join(', ')}]`);
    }

    // Check skipped rules
    const skippedMatch = expectedSkipped.every((id) => actual.skippedRules.includes(id));
    if (!skippedMatch) {
      mismatches.push(`Expected rules [${expectedSkipped.join(', ')}] to be skipped, got [${actual.skippedRules.join(', ')}]`);
    }

    // Check blocked status
    if (expectedBlocked !== actual.blocked) {
      mismatches.push(`Expected blocked=${expectedBlocked}, got blocked=${actual.blocked}`);
    }

    // Check merit range
    let meritInRange: boolean | null = null;
    const meritRange = expected['meritRange'] as { min: number; max: number } | undefined;
    if (meritRange) {
      meritInRange = actual.totalMerit >= meritRange.min && actual.totalMerit <= meritRange.max;
      if (!meritInRange) {
        mismatches.push(`Merit ${actual.totalMerit} not in range [${meritRange.min}, ${meritRange.max}]`);
      }
    }

    // Check bonus range
    let bonusInRange: boolean | null = null;
    const bonusRange = expected['bonusRange'] as { min: number; max: number } | undefined;
    if (bonusRange) {
      bonusInRange = actual.totalBonus >= bonusRange.min && actual.totalBonus <= bonusRange.max;
      if (!bonusInRange) {
        mismatches.push(`Bonus ${actual.totalBonus} not in range [${bonusRange.min}, ${bonusRange.max}]`);
      }
    }

    // Check LTI range
    let ltiInRange: boolean | null = null;
    const ltiRange = expected['ltiRange'] as { min: number; max: number } | undefined;
    if (ltiRange) {
      ltiInRange = actual.totalLTI >= ltiRange.min && actual.totalLTI <= ltiRange.max;
      if (!ltiInRange) {
        mismatches.push(`LTI ${actual.totalLTI} not in range [${ltiRange.min}, ${ltiRange.max}]`);
      }
    }

    return {
      testCaseId,
      name,
      passed: mismatches.length === 0,
      details: {
        expectedApplied,
        actualApplied: actual.appliedRules,
        expectedSkipped,
        actualSkipped: actual.skippedRules,
        expectedBlocked,
        actualBlocked: actual.blocked,
        meritInRange,
        bonusInRange,
        ltiInRange,
        mismatches,
      },
    };
  }
}

