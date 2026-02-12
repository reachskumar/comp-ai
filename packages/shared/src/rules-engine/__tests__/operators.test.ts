import { describe, it, expect } from 'vitest';
import { evaluateCondition, getFieldValue } from '../operators.js';
import type { EmployeeData, RuleCondition } from '../types.js';

const employee: EmployeeData = {
  id: 'emp-1',
  employeeCode: 'E001',
  department: 'Engineering',
  level: 'L5',
  title: 'Senior Engineer',
  location: 'San Francisco',
  baseSalary: 150000,
  hireDate: new Date('2022-03-15'),
  performanceRating: 4.2,
  managerId: 'mgr-1',
};

describe('getFieldValue', () => {
  it('resolves top-level fields', () => {
    expect(getFieldValue(employee, 'department')).toBe('Engineering');
    expect(getFieldValue(employee, 'baseSalary')).toBe(150000);
  });

  it('returns undefined for missing fields', () => {
    expect(getFieldValue(employee, 'nonexistent')).toBeUndefined();
  });
});

describe('evaluateCondition', () => {
  it('eq: matches equal values', () => {
    const cond: RuleCondition = { field: 'department', operator: 'eq', value: 'Engineering' };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('eq: rejects unequal values', () => {
    const cond: RuleCondition = { field: 'department', operator: 'eq', value: 'Sales' };
    expect(evaluateCondition(employee, cond).passed).toBe(false);
  });

  it('neq: matches unequal values', () => {
    const cond: RuleCondition = { field: 'department', operator: 'neq', value: 'Sales' };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('gt: numeric greater than', () => {
    const cond: RuleCondition = { field: 'baseSalary', operator: 'gt', value: 100000 };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('gt: fails when not greater', () => {
    const cond: RuleCondition = { field: 'baseSalary', operator: 'gt', value: 200000 };
    expect(evaluateCondition(employee, cond).passed).toBe(false);
  });

  it('gte: numeric greater than or equal', () => {
    const cond: RuleCondition = { field: 'baseSalary', operator: 'gte', value: 150000 };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('lt: numeric less than', () => {
    const cond: RuleCondition = { field: 'baseSalary', operator: 'lt', value: 200000 };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('lte: numeric less than or equal', () => {
    const cond: RuleCondition = { field: 'baseSalary', operator: 'lte', value: 150000 };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('in: value in array', () => {
    const cond: RuleCondition = { field: 'department', operator: 'in', value: ['Engineering', 'Product'] };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('in: value not in array', () => {
    const cond: RuleCondition = { field: 'department', operator: 'in', value: ['Sales', 'Marketing'] };
    expect(evaluateCondition(employee, cond).passed).toBe(false);
  });

  it('notIn: value not in array', () => {
    const cond: RuleCondition = { field: 'department', operator: 'notIn', value: ['Sales', 'Marketing'] };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('between: value in range', () => {
    const cond: RuleCondition = { field: 'baseSalary', operator: 'between', value: [100000, 200000] };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('between: value outside range', () => {
    const cond: RuleCondition = { field: 'baseSalary', operator: 'between', value: [200000, 300000] };
    expect(evaluateCondition(employee, cond).passed).toBe(false);
  });

  it('contains: string contains substring', () => {
    const cond: RuleCondition = { field: 'location', operator: 'contains', value: 'Francisco' };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('startsWith: string starts with prefix', () => {
    const cond: RuleCondition = { field: 'location', operator: 'startsWith', value: 'San' };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('matches: regex match', () => {
    const cond: RuleCondition = { field: 'level', operator: 'matches', value: '^L[0-9]+$' };
    expect(evaluateCondition(employee, cond).passed).toBe(true);
  });

  it('matches: regex no match', () => {
    const cond: RuleCondition = { field: 'level', operator: 'matches', value: '^M[0-9]+$' };
    expect(evaluateCondition(employee, cond).passed).toBe(false);
  });

  it('returns condition details in result', () => {
    const cond: RuleCondition = { field: 'baseSalary', operator: 'gt', value: 100000 };
    const result = evaluateCondition(employee, cond);
    expect(result.field).toBe('baseSalary');
    expect(result.operator).toBe('gt');
    expect(result.expected).toBe(100000);
    expect(result.actual).toBe(150000);
    expect(result.passed).toBe(true);
  });
});

