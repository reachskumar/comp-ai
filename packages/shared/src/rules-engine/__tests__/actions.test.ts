import { describe, it, expect } from 'vitest';
import { executeAction } from '../actions.js';
import type { CurrentAmounts, EmployeeData, RuleAction } from '../types.js';

const employee: EmployeeData = {
  id: 'emp-1',
  employeeCode: 'E001',
  department: 'Engineering',
  level: 'L5',
  baseSalary: 100000,
  hireDate: new Date('2022-01-01'),
};

function amounts(merit = 0, bonus = 0, lti = 0): CurrentAmounts {
  return { merit, bonus, lti };
}

describe('executeAction', () => {
  it('setMerit: calculates percentage of base salary', () => {
    const action: RuleAction = { type: 'setMerit', params: { percentage: 5 } };
    const result = executeAction(action, employee, amounts());
    expect(result.appliedAction.calculatedValue).toBe(5000);
    expect(result.amountUpdates.merit).toBe(5000);
  });

  it('setBonus: calculates percentage of base salary', () => {
    const action: RuleAction = { type: 'setBonus', params: { percentage: 10 } };
    const result = executeAction(action, employee, amounts());
    expect(result.appliedAction.calculatedValue).toBe(10000);
    expect(result.amountUpdates.bonus).toBe(10000);
  });

  it('setBonus: uses fixed amount when provided', () => {
    const action: RuleAction = { type: 'setBonus', params: { amount: 7500 } };
    const result = executeAction(action, employee, amounts());
    expect(result.appliedAction.calculatedValue).toBe(7500);
  });

  it('setLTI: calculates percentage of base salary', () => {
    const action: RuleAction = { type: 'setLTI', params: { percentage: 20 } };
    const result = executeAction(action, employee, amounts());
    expect(result.appliedAction.calculatedValue).toBe(20000);
    expect(result.amountUpdates.lti).toBe(20000);
  });

  it('setLTI: uses fixed amount when provided', () => {
    const action: RuleAction = { type: 'setLTI', params: { amount: 50000 } };
    const result = executeAction(action, employee, amounts());
    expect(result.appliedAction.calculatedValue).toBe(50000);
  });

  it('applyMultiplier: multiplies merit by factor', () => {
    const action: RuleAction = { type: 'applyMultiplier', params: { multiplier: 1.5, target: 'merit' } };
    const result = executeAction(action, employee, amounts(5000));
    expect(result.appliedAction.calculatedValue).toBe(7500);
    expect(result.amountUpdates.merit).toBe(7500);
  });

  it('applyFloor: raises amount to floor', () => {
    const action: RuleAction = { type: 'applyFloor', params: { amount: 3000, target: 'merit' } };
    const result = executeAction(action, employee, amounts(1000));
    expect(result.appliedAction.calculatedValue).toBe(3000);
    expect(result.amountUpdates.merit).toBe(3000);
  });

  it('applyFloor: does not lower amount above floor', () => {
    const action: RuleAction = { type: 'applyFloor', params: { amount: 3000, target: 'merit' } };
    const result = executeAction(action, employee, amounts(5000));
    expect(result.appliedAction.calculatedValue).toBe(5000);
    expect(result.amountUpdates.merit).toBeUndefined();
  });

  it('applyCap: lowers amount to cap', () => {
    const action: RuleAction = { type: 'applyCap', params: { amount: 3000, target: 'merit' } };
    const result = executeAction(action, employee, amounts(5000));
    expect(result.appliedAction.calculatedValue).toBe(3000);
    expect(result.amountUpdates.merit).toBe(3000);
  });

  it('applyCap: does not raise amount below cap', () => {
    const action: RuleAction = { type: 'applyCap', params: { amount: 10000, target: 'merit' } };
    const result = executeAction(action, employee, amounts(5000));
    expect(result.appliedAction.calculatedValue).toBe(5000);
    expect(result.amountUpdates.merit).toBeUndefined();
  });

  it('flag: returns flag message', () => {
    const action: RuleAction = { type: 'flag', params: { message: 'Needs review' } };
    const result = executeAction(action, employee, amounts());
    expect(result.flag).toBe('Needs review');
    expect(result.appliedAction.calculatedValue).toBe(0);
  });

  it('block: returns block reason', () => {
    const action: RuleAction = { type: 'block', params: { reason: 'On PIP' } };
    const result = executeAction(action, employee, amounts());
    expect(result.block).toBe('On PIP');
    expect(result.appliedAction.calculatedValue).toBe(0);
  });
});

