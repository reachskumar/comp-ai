import { describe, it, expect } from 'vitest';
import { calculateRetroAdjustment } from '../retro.js';
import type { SalaryChange } from '../types.js';

describe('calculateRetroAdjustment', () => {
  it('single salary change: calculates correct retro amount', () => {
    const changes: SalaryChange[] = [
      { oldSalary: 100000, newSalary: 110000, effectiveDate: new Date('2025-01-01') },
    ];
    const result = calculateRetroAdjustment(
      changes,
      new Date('2025-01-01'),
      new Date('2025-07-01'),
    );
    // 10000/365 * 181 days ≈ 4958.90
    expect(result.totalAdjustment).toBeCloseTo(4958.90, 0);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]!.days).toBe(181);
  });

  it('multiple stacked changes', () => {
    const changes: SalaryChange[] = [
      { oldSalary: 100000, newSalary: 110000, effectiveDate: new Date('2025-01-01') },
      { oldSalary: 110000, newSalary: 120000, effectiveDate: new Date('2025-04-01') },
    ];
    const result = calculateRetroAdjustment(
      changes,
      new Date('2025-01-01'),
      new Date('2025-07-01'),
    );
    // First segment: Jan 1 - Apr 1 = 90 days, diff = 10000/365 * 90 ≈ 2465.75
    // Second segment: Apr 1 - Jul 1 = 91 days, diff = 10000/365 * 91 ≈ 2493.15
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0]!.days).toBe(90);
    expect(result.breakdown[1]!.days).toBe(91);
    expect(result.totalAdjustment).toBeCloseTo(2465.75 + 2493.15, 0);
  });

  it('empty changes returns zero', () => {
    const result = calculateRetroAdjustment([], new Date('2025-01-01'), new Date('2025-07-01'));
    expect(result.totalAdjustment).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });

  it('change effective before period start is clamped', () => {
    const changes: SalaryChange[] = [
      { oldSalary: 100000, newSalary: 110000, effectiveDate: new Date('2024-06-01') },
    ];
    const result = calculateRetroAdjustment(
      changes,
      new Date('2025-01-01'),
      new Date('2025-07-01'),
    );
    // Should calculate from period start, not effective date
    expect(result.breakdown[0]!.days).toBe(181);
  });

  it('change effective after period end produces no adjustment', () => {
    const changes: SalaryChange[] = [
      { oldSalary: 100000, newSalary: 110000, effectiveDate: new Date('2026-01-01') },
    ];
    const result = calculateRetroAdjustment(
      changes,
      new Date('2025-01-01'),
      new Date('2025-07-01'),
    );
    expect(result.totalAdjustment).toBe(0);
    expect(result.breakdown).toHaveLength(0);
  });

  it('salary decrease produces negative adjustment', () => {
    const changes: SalaryChange[] = [
      { oldSalary: 110000, newSalary: 100000, effectiveDate: new Date('2025-01-01') },
    ];
    const result = calculateRetroAdjustment(
      changes,
      new Date('2025-01-01'),
      new Date('2025-07-01'),
    );
    expect(result.totalAdjustment).toBeLessThan(0);
  });

  it('period end before period start returns zero', () => {
    const changes: SalaryChange[] = [
      { oldSalary: 100000, newSalary: 110000, effectiveDate: new Date('2025-01-01') },
    ];
    const result = calculateRetroAdjustment(
      changes,
      new Date('2025-07-01'),
      new Date('2025-01-01'),
    );
    expect(result.totalAdjustment).toBe(0);
  });
});

