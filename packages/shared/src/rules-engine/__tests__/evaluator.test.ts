import { describe, it, expect } from 'vitest';
import { evaluateRules } from '../evaluator.js';
import type { EmployeeData, Rule, RuleSet } from '../types.js';

const employee: EmployeeData = {
  id: 'emp-1',
  employeeCode: 'E001',
  department: 'Engineering',
  level: 'L5',
  baseSalary: 100000,
  hireDate: new Date('2022-01-01'),
  performanceRating: 4.5,
};

function makeRuleSet(rules: Rule[]): RuleSet {
  return { id: 'rs-1', name: 'Test RuleSet', rules };
}

function meritRule(id: string, priority: number, percentage: number, conditions: Rule['conditions'] = []): Rule {
  return {
    id, name: `Merit ${percentage}%`, type: 'MERIT', priority, enabled: true,
    conditions, actions: [{ type: 'setMerit', params: { percentage } }],
  };
}

describe('evaluateRules', () => {
  it('returns empty result for empty rule set', () => {
    const result = evaluateRules(employee, makeRuleSet([]));
    expect(result.decisions).toHaveLength(0);
    expect(result.totalMerit).toBe(0);
    expect(result.totalBonus).toBe(0);
    expect(result.totalLTI).toBe(0);
    expect(result.blocked).toBe(false);
  });

  it('applies matching rule', () => {
    const rules: Rule[] = [
      meritRule('r1', 1, 5, [{ field: 'department', operator: 'eq', value: 'Engineering' }]),
    ];
    const result = evaluateRules(employee, makeRuleSet(rules));
    expect(result.appliedRules).toContain('r1');
    expect(result.totalMerit).toBe(5000);
  });

  it('skips non-matching rule', () => {
    const rules: Rule[] = [
      meritRule('r1', 1, 5, [{ field: 'department', operator: 'eq', value: 'Sales' }]),
    ];
    const result = evaluateRules(employee, makeRuleSet(rules));
    expect(result.skippedRules).toContain('r1');
    expect(result.totalMerit).toBe(0);
  });

  it('skips disabled rules', () => {
    const rules: Rule[] = [{
      id: 'r1', name: 'Disabled', type: 'MERIT', priority: 1, enabled: false,
      conditions: [], actions: [{ type: 'setMerit', params: { percentage: 5 } }],
    }];
    const result = evaluateRules(employee, makeRuleSet(rules));
    expect(result.skippedRules).toContain('r1');
  });

  it('priority ordering: higher priority (lower number) rule wins for same type', () => {
    const rules: Rule[] = [
      meritRule('r-low', 10, 3),
      meritRule('r-high', 1, 5),
    ];
    const result = evaluateRules(employee, makeRuleSet(rules));
    // r-high runs first (priority 1), sets merit to 5000
    // r-low runs second (priority 10), overwrites merit to 3000
    // Both are applied since they both match
    expect(result.appliedRules).toContain('r-high');
    expect(result.appliedRules).toContain('r-low');
    // Last one wins for setMerit (overwrites)
    expect(result.totalMerit).toBe(3000);
  });

  it('block action prevents all compensation', () => {
    const rules: Rule[] = [
      meritRule('r1', 2, 5),
      {
        id: 'r-block', name: 'Block PIP', type: 'ELIGIBILITY', priority: 1, enabled: true,
        conditions: [], actions: [{ type: 'block', params: { reason: 'On PIP' } }],
      },
    ];
    const result = evaluateRules(employee, makeRuleSet(rules));
    expect(result.blocked).toBe(true);
    expect(result.totalMerit).toBe(0);
    expect(result.totalBonus).toBe(0);
    expect(result.totalLTI).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('flag action adds flags but does not block', () => {
    const rules: Rule[] = [
      meritRule('r1', 1, 5),
      {
        id: 'r-flag', name: 'Flag review', type: 'CUSTOM', priority: 2, enabled: true,
        conditions: [], actions: [{ type: 'flag', params: { message: 'High performer' } }],
      },
    ];
    const result = evaluateRules(employee, makeRuleSet(rules));
    expect(result.blocked).toBe(false);
    expect(result.flags).toContain('High performer');
    expect(result.totalMerit).toBe(5000);
  });

  it('cap/floor rules apply after regular rules', () => {
    const rules: Rule[] = [
      meritRule('r1', 1, 10), // 10000
      {
        id: 'r-cap', name: 'Cap merit', type: 'CAP', priority: 1, enabled: true,
        conditions: [], actions: [{ type: 'applyCap', params: { amount: 7000, target: 'merit' } }],
      },
    ];
    const result = evaluateRules(employee, makeRuleSet(rules));
    expect(result.totalMerit).toBe(7000);
  });

  it('floor overrides when merit is below floor', () => {
    const rules: Rule[] = [
      meritRule('r1', 1, 2), // 2000
      {
        id: 'r-floor', name: 'Floor merit', type: 'FLOOR', priority: 1, enabled: true,
        conditions: [], actions: [{ type: 'applyFloor', params: { amount: 3000, target: 'merit' } }],
      },
    ];
    const result = evaluateRules(employee, makeRuleSet(rules));
    expect(result.totalMerit).toBe(3000);
  });

  it('generates audit trail for all rules', () => {
    const rules: Rule[] = [
      meritRule('r1', 1, 5, [{ field: 'department', operator: 'eq', value: 'Engineering' }]),
      meritRule('r2', 2, 3, [{ field: 'department', operator: 'eq', value: 'Sales' }]),
    ];
    const result = evaluateRules(employee, makeRuleSet(rules));
    expect(result.auditTrail).toHaveLength(2);
    expect(result.auditTrail[0]!.matched).toBe(true);
    expect(result.auditTrail[1]!.matched).toBe(false);
  });

  it('no matching rules returns zero amounts', () => {
    const rules: Rule[] = [
      meritRule('r1', 1, 5, [{ field: 'department', operator: 'eq', value: 'Sales' }]),
      meritRule('r2', 2, 3, [{ field: 'department', operator: 'eq', value: 'Marketing' }]),
    ];
    const result = evaluateRules(employee, makeRuleSet(rules));
    expect(result.totalMerit).toBe(0);
    expect(result.appliedRules).toHaveLength(0);
    expect(result.skippedRules).toHaveLength(2);
  });

  it('handles zero salary employee', () => {
    const zeroEmp: EmployeeData = { ...employee, baseSalary: 0 };
    const rules: Rule[] = [meritRule('r1', 1, 5)];
    const result = evaluateRules(zeroEmp, makeRuleSet(rules));
    expect(result.totalMerit).toBe(0);
  });

  it('complex scenario: 5+ rules with mixed conditions/actions', () => {
    const rules: Rule[] = [
      // Merit for engineering
      {
        id: 'r1', name: 'Eng merit', type: 'MERIT', priority: 1, enabled: true,
        conditions: [{ field: 'department', operator: 'eq', value: 'Engineering' }],
        actions: [{ type: 'setMerit', params: { percentage: 5 } }],
      },
      // Bonus for high performers
      {
        id: 'r2', name: 'Perf bonus', type: 'BONUS', priority: 2, enabled: true,
        conditions: [{ field: 'performanceRating', operator: 'gte', value: 4.0 }],
        actions: [{ type: 'setBonus', params: { percentage: 10 } }],
      },
      // LTI for L5+
      {
        id: 'r3', name: 'LTI grant', type: 'LTI', priority: 3, enabled: true,
        conditions: [{ field: 'level', operator: 'in', value: ['L5', 'L6', 'L7'] }],
        actions: [{ type: 'setLTI', params: { percentage: 15 } }],
      },
      // Flag for high salary
      {
        id: 'r4', name: 'High salary flag', type: 'CUSTOM', priority: 4, enabled: true,
        conditions: [{ field: 'baseSalary', operator: 'gte', value: 90000 }],
        actions: [{ type: 'flag', params: { message: 'High salary - needs VP approval' } }],
      },
      // Cap merit at 7000
      {
        id: 'r5', name: 'Merit cap', type: 'CAP', priority: 5, enabled: true,
        conditions: [],
        actions: [{ type: 'applyCap', params: { amount: 7000, target: 'merit' } }],
      },
      // Disabled rule (should be skipped)
      {
        id: 'r6', name: 'Disabled rule', type: 'CUSTOM', priority: 6, enabled: false,
        conditions: [],
        actions: [{ type: 'setMerit', params: { percentage: 99 } }],
      },
    ];

    const result = evaluateRules(employee, makeRuleSet(rules));

    // Merit: 5% of 100k = 5000, capped at 7000 → stays 5000
    expect(result.totalMerit).toBe(5000);
    // Bonus: 10% of 100k = 10000
    expect(result.totalBonus).toBe(10000);
    // LTI: 15% of 100k = 15000
    expect(result.totalLTI).toBe(15000);
    // Flag present
    expect(result.flags).toContain('High salary - needs VP approval');
    // Not blocked
    expect(result.blocked).toBe(false);
    // Applied: r1, r2, r3, r4, r5
    expect(result.appliedRules).toHaveLength(5);
    // Skipped: r6 (disabled)
    expect(result.skippedRules).toContain('r6');
    // Audit trail has entries for all rules
    expect(result.auditTrail.length).toBeGreaterThanOrEqual(6);
  });
});

