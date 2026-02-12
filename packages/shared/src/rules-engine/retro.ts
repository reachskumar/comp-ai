/**
 * Retroactive Adjustment Calculations
 * Calculate the difference owed when salary changes are backdated.
 */

import type { RetroAdjustment, RetroBreakdown, SalaryChange } from './types.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Calculate the number of calendar days between two dates. */
function daysBetween(start: Date, end: Date): number {
  const msPerDay = 86_400_000;
  const startMs = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endMs = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((endMs - startMs) / msPerDay));
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Calculate retroactive adjustment for one or more salary changes.
 *
 * Given a list of salary changes (each with old salary, new salary, and effective date),
 * calculates the total difference owed for the period between periodStart and periodEnd.
 *
 * Changes are sorted by effective date and applied in order.
 * Each change creates a breakdown segment from its effective date to the next change
 * (or periodEnd).
 *
 * Daily salary = annualSalary / 365
 *
 * @param changes - Array of salary changes, each with oldSalary, newSalary, effectiveDate
 * @param periodStart - Start of the retro calculation period
 * @param periodEnd - End of the retro calculation period (typically current date)
 */
export function calculateRetroAdjustment(
  changes: SalaryChange[],
  periodStart: Date,
  periodEnd: Date,
): RetroAdjustment {
  if (changes.length === 0 || periodEnd <= periodStart) {
    return {
      totalAdjustment: 0,
      breakdown: [],
      periodStart,
      periodEnd,
    };
  }

  // Sort changes by effective date (ascending)
  const sorted = [...changes].sort(
    (a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime(),
  );

  const breakdown: RetroBreakdown[] = [];
  let totalAdjustment = 0;
  const daysInYear = 365;

  for (let i = 0; i < sorted.length; i++) {
    const change = sorted[i]!;

    // Segment start: max of change effective date and period start
    const segStart = change.effectiveDate < periodStart ? periodStart : change.effectiveDate;

    // Segment end: min of next change effective date and period end
    const nextChange = sorted[i + 1];
    const segEnd = nextChange
      ? (nextChange.effectiveDate < periodEnd ? nextChange.effectiveDate : periodEnd)
      : periodEnd;

    // Skip if segment is invalid
    if (segEnd <= segStart) continue;

    const days = daysBetween(segStart, segEnd);
    const dailyDiff = (change.newSalary - change.oldSalary) / daysInYear;
    const difference = Math.round(dailyDiff * days * 100) / 100;

    breakdown.push({
      periodStart: segStart,
      periodEnd: segEnd,
      oldSalary: change.oldSalary,
      newSalary: change.newSalary,
      difference,
      days,
    });

    totalAdjustment += difference;
  }

  return {
    totalAdjustment: Math.round(totalAdjustment * 100) / 100,
    breakdown,
    periodStart,
    periodEnd,
  };
}

