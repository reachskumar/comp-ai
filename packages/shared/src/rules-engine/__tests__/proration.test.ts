import { describe, it, expect } from 'vitest';
import { calculateProration } from '../proration.js';
import type { EmployeeData } from '../types.js';

const periodStart = new Date('2025-01-01');
const periodEnd = new Date('2026-01-01');

function makeEmployee(overrides: Partial<EmployeeData> = {}): EmployeeData {
  return {
    id: 'emp-1',
    employeeCode: 'E001',
    department: 'Engineering',
    level: 'L5',
    baseSalary: 100000,
    hireDate: new Date('2020-01-01'),
    ...overrides,
  };
}

describe('calculateProration', () => {
  it('full year employee gets 100% proration', () => {
    const emp = makeEmployee();
    const result = calculateProration(emp, 10000, periodStart, periodEnd);
    expect(result.prorationFactor).toBe(1);
    expect(result.proratedAmount).toBe(10000);
    expect(result.eligibleDays).toBe(365);
    expect(result.totalDays).toBe(365);
  });

  it('new hire mid-year gets prorated amount', () => {
    // Hired July 1 = ~183/365 days
    const emp = makeEmployee({ hireDate: new Date('2025-07-01') });
    const result = calculateProration(emp, 10000, periodStart, periodEnd);
    expect(result.prorationFactor).toBeCloseTo(184 / 365, 2);
    expect(result.proratedAmount).toBeCloseTo(10000 * (184 / 365), 0);
    expect(result.eligibleDays).toBe(184);
  });

  it('termination mid-year gets prorated amount', () => {
    // Terminated March 31 = 90/365 days
    const emp = makeEmployee({ terminationDate: new Date('2025-04-01') });
    const result = calculateProration(emp, 10000, periodStart, periodEnd);
    expect(result.eligibleDays).toBe(90);
    expect(result.prorationFactor).toBeCloseTo(90 / 365, 2);
  });

  it('LOA days reduce eligible days', () => {
    const emp = makeEmployee();
    const result = calculateProration(emp, 10000, periodStart, periodEnd, { loaDays: 30 });
    expect(result.eligibleDays).toBe(335);
    expect(result.prorationFactor).toBeCloseTo(335 / 365, 2);
  });

  it('mid-year transfer prorates from transfer date', () => {
    const emp = makeEmployee();
    const result = calculateProration(emp, 10000, periodStart, periodEnd, {
      transferDate: new Date('2025-07-01'),
    });
    expect(result.eligibleDays).toBe(184);
  });

  it('employee hired after period end gets zero', () => {
    const emp = makeEmployee({ hireDate: new Date('2027-01-01') });
    const result = calculateProration(emp, 10000, periodStart, periodEnd);
    expect(result.proratedAmount).toBe(0);
    expect(result.prorationFactor).toBe(0);
  });

  it('employee terminated before period start gets zero', () => {
    const emp = makeEmployee({ terminationDate: new Date('2024-06-01') });
    const result = calculateProration(emp, 10000, periodStart, periodEnd);
    expect(result.proratedAmount).toBe(0);
  });

  it('invalid period (start after end) returns zero', () => {
    const emp = makeEmployee();
    const result = calculateProration(emp, 10000, periodEnd, periodStart);
    expect(result.proratedAmount).toBe(0);
    expect(result.totalDays).toBe(0);
  });

  it('combined new hire + LOA', () => {
    // Hired July 1 (184 eligible days), 30 LOA days = 154 eligible
    const emp = makeEmployee({ hireDate: new Date('2025-07-01') });
    const result = calculateProration(emp, 10000, periodStart, periodEnd, { loaDays: 30 });
    expect(result.eligibleDays).toBe(154);
  });
});

