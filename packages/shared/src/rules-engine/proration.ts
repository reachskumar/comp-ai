/**
 * Proration Calculations
 * Calculate prorated compensation amounts based on employment dates and leave.
 */

import type { EmployeeData, ProratedAmount } from './types.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Calculate the number of calendar days between two dates (inclusive of start, exclusive of end). */
function daysBetween(start: Date, end: Date): number {
  const msPerDay = 86_400_000;
  const startMs = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endMs = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((endMs - startMs) / msPerDay));
}

/** Clamp a date to be within [min, max]. */
function clampDate(date: Date, min: Date, max: Date): Date {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export interface ProrateOptions {
  /** Days of leave of absence to subtract from eligible days */
  loaDays?: number;
  /** If the employee transferred mid-year, the date they joined the current department */
  transferDate?: Date;
}

/**
 * Calculate prorated amount for an employee based on their employment dates
 * within a given period.
 *
 * Handles:
 * - New hire proration (hired after period start)
 * - Termination proration (terminated before period end)
 * - Leave of absence (subtract LOA days)
 * - Mid-year transfer (prorate from transfer date)
 */
export function calculateProration(
  employee: EmployeeData,
  amount: number,
  periodStart: Date,
  periodEnd: Date,
  options: ProrateOptions = {},
): ProratedAmount {
  const totalDays = daysBetween(periodStart, periodEnd);

  if (totalDays <= 0) {
    return {
      originalAmount: amount,
      proratedAmount: 0,
      prorationFactor: 0,
      eligibleDays: 0,
      totalDays: 0,
      description: 'Invalid period: start date is after end date',
    };
  }

  // Determine the effective start date for this employee
  let effectiveStart = clampDate(employee.hireDate, periodStart, periodEnd);

  // If there's a transfer date, use the later of hire date and transfer date
  if (options.transferDate) {
    const transferClamped = clampDate(options.transferDate, periodStart, periodEnd);
    if (transferClamped > effectiveStart) {
      effectiveStart = transferClamped;
    }
  }

  // Determine the effective end date
  const effectiveEnd = employee.terminationDate
    ? clampDate(employee.terminationDate, periodStart, periodEnd)
    : periodEnd;

  // If employee left before they started (in this period), no eligibility
  if (effectiveEnd <= effectiveStart) {
    return {
      originalAmount: amount,
      proratedAmount: 0,
      prorationFactor: 0,
      eligibleDays: 0,
      totalDays,
      description: 'Employee not eligible during this period',
    };
  }

  let eligibleDays = daysBetween(effectiveStart, effectiveEnd);

  // Subtract LOA days
  const loaDays = options.loaDays ?? 0;
  eligibleDays = Math.max(0, eligibleDays - loaDays);

  const prorationFactor = eligibleDays / totalDays;
  const proratedAmount = Math.round(amount * prorationFactor * 100) / 100;

  // Build description
  const parts: string[] = [];
  if (employee.hireDate > periodStart) {
    parts.push(`hired ${employee.hireDate.toISOString().split('T')[0]}`);
  }
  if (employee.terminationDate && employee.terminationDate < periodEnd) {
    parts.push(`terminated ${employee.terminationDate.toISOString().split('T')[0]}`);
  }
  if (options.transferDate) {
    parts.push(`transferred ${options.transferDate.toISOString().split('T')[0]}`);
  }
  if (loaDays > 0) {
    parts.push(`${loaDays} LOA days`);
  }

  const description = parts.length > 0
    ? `Prorated ${eligibleDays}/${totalDays} days (${(prorationFactor * 100).toFixed(1)}%): ${parts.join(', ')}`
    : `Full period: ${eligibleDays}/${totalDays} days`;

  return {
    originalAmount: amount,
    proratedAmount,
    prorationFactor,
    eligibleDays,
    totalDays,
    description,
  };
}

