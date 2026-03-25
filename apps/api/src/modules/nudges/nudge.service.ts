import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database';

export interface Nudge {
  id: string;
  type:
    | 'pay_below_range'
    | 'pay_above_range'
    | 'performance_mismatch'
    | 'gender_gap_risk'
    | 'compa_ratio_outlier';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  employeeCount: number;
  employees: Array<{
    id: string;
    name: string;
    department: string;
    level: string;
    salary: number;
    compaRatio: number | null;
    performanceRating: number | null;
  }>;
  suggestedAction: string;
  copilotPrompt: string; // pre-filled prompt for "Ask Copilot"
}

@Injectable()
export class NudgeService {
  private readonly logger = new Logger(NudgeService.name);

  constructor(private readonly db: DatabaseService) {}

  async generateNudges(tenantId: string): Promise<Nudge[]> {
    const nudges: Nudge[] = [];

    const { employees, bands } = await this.db.forTenant(tenantId, async (tx) => ({
      employees: await tx.employee.findMany({
        where: { tenantId, terminationDate: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          department: true,
          level: true,
          baseSalary: true,
          performanceRating: true,
          gender: true,
          jobFamily: true,
          location: true,
          currency: true,
          salaryBandId: true,
          salaryBand: {
            select: { p10: true, p25: true, p50: true, p75: true, p90: true },
          },
        },
      }),
      bands: await tx.salaryBand.findMany({
        where: { tenantId },
        select: {
          id: true,
          jobFamily: true,
          level: true,
          location: true,
          currency: true,
          p25: true,
          p50: true,
          p75: true,
        },
      }),
    }));

    // Map employees to their salary band (direct relation or by matching)
    const enriched = employees.map((emp) => {
      let band = emp.salaryBand;
      if (!band) {
        // Try matching by jobFamily + level
        const match = bands.find(
          (b) =>
            b.jobFamily === emp.jobFamily && b.level === emp.level && b.currency === emp.currency,
        );
        if (match)
          band = { p10: 0 as any, p25: match.p25, p50: match.p50, p75: match.p75, p90: 0 as any };
      }
      const salary = Number(emp.baseSalary);
      const p25 = band ? Number(band.p25) : null;
      const p50 = band ? Number(band.p50) : null;
      const p75 = band ? Number(band.p75) : null;
      const compaRatio = p50 && p50 > 0 ? salary / p50 : null;

      return {
        id: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        department: emp.department,
        level: emp.level,
        salary,
        p25,
        p50,
        p75,
        compaRatio,
        performanceRating: emp.performanceRating ? Number(emp.performanceRating) : null,
        gender: emp.gender,
      };
    });

    // ── Nudge 1: Pay below range ──
    const belowRange = enriched.filter((e) => e.p25 !== null && e.salary < e.p25!);
    if (belowRange.length > 0) {
      nudges.push({
        id: 'nudge-below-range',
        type: 'pay_below_range',
        severity: 'critical',
        title: 'Employees Paid Below Range',
        description: `${belowRange.length} employee${belowRange.length > 1 ? 's are' : ' is'} paid below the 25th percentile of their salary band.`,
        employeeCount: belowRange.length,
        employees: belowRange.slice(0, 10).map((e) => ({
          id: e.id,
          name: e.name,
          department: e.department,
          level: e.level,
          salary: e.salary,
          compaRatio: e.compaRatio,
          performanceRating: e.performanceRating,
        })),
        suggestedAction:
          'Review these employees for potential merit increases to bring them within range.',
        copilotPrompt: `I have ${belowRange.length} employees paid below their salary band range. Can you analyze which ones should be prioritized for increases based on performance and tenure?`,
      });
    }

    // ── Nudge 2: Pay above range ──
    const aboveRange = enriched.filter((e) => e.p75 !== null && e.salary > e.p75!);
    if (aboveRange.length > 0) {
      nudges.push({
        id: 'nudge-above-range',
        type: 'pay_above_range',
        severity: 'warning',
        title: 'Employees Paid Above Range',
        description: `${aboveRange.length} employee${aboveRange.length > 1 ? 's are' : ' is'} paid above the 75th percentile of their salary band.`,
        employeeCount: aboveRange.length,
        employees: aboveRange.slice(0, 10).map((e) => ({
          id: e.id,
          name: e.name,
          department: e.department,
          level: e.level,
          salary: e.salary,
          compaRatio: e.compaRatio,
          performanceRating: e.performanceRating,
        })),
        suggestedAction:
          'Consider lump-sum bonuses instead of base increases, or evaluate for promotion.',
        copilotPrompt: `I have ${aboveRange.length} employees paid above their salary band. Should I consider promotions, lump-sum bonuses, or other strategies?`,
      });
    }

    // ── Nudge 3: Performance mismatch ──
    const perfMismatch = enriched.filter(
      (e) =>
        e.performanceRating !== null &&
        e.compaRatio !== null &&
        ((e.performanceRating >= 4 && e.compaRatio < 0.9) ||
          (e.performanceRating <= 2 && e.compaRatio > 1.1)),
    );
    if (perfMismatch.length > 0) {
      nudges.push({
        id: 'nudge-perf-mismatch',
        type: 'performance_mismatch',
        severity: 'warning',
        title: 'Performance-Pay Misalignment',
        description: `${perfMismatch.length} employee${perfMismatch.length > 1 ? 's have' : ' has'} a mismatch between performance rating and pay positioning.`,
        employeeCount: perfMismatch.length,
        employees: perfMismatch.slice(0, 10).map((e) => ({
          id: e.id,
          name: e.name,
          department: e.department,
          level: e.level,
          salary: e.salary,
          compaRatio: e.compaRatio,
          performanceRating: e.performanceRating,
        })),
        suggestedAction:
          'High performers below midpoint may be at attrition risk. Low performers above range may indicate need for PIP or role adjustment.',
        copilotPrompt: `I have ${perfMismatch.length} employees with a mismatch between their performance and pay. Can you identify the high-performers being underpaid and recommend merit increases?`,
      });
    }

    // ── Nudge 4: Gender pay gap risk ──
    const byGender = new Map<string, { salaries: number[]; count: number }>();
    for (const e of enriched) {
      if (!e.gender || e.gender === 'UNDISCLOSED') continue;
      const entry = byGender.get(e.gender) ?? { salaries: [], count: 0 };
      entry.salaries.push(e.salary);
      entry.count++;
      byGender.set(e.gender, entry);
    }
    const maleData = byGender.get('MALE');
    const femaleData = byGender.get('FEMALE');
    if (maleData && femaleData && maleData.count >= 5 && femaleData.count >= 5) {
      const maleAvg = maleData.salaries.reduce((a, b) => a + b, 0) / maleData.count;
      const femaleAvg = femaleData.salaries.reduce((a, b) => a + b, 0) / femaleData.count;
      const gap = ((maleAvg - femaleAvg) / maleAvg) * 100;
      if (gap > 5) {
        nudges.push({
          id: 'nudge-gender-gap',
          type: 'gender_gap_risk',
          severity: gap > 10 ? 'critical' : 'warning',
          title: 'Gender Pay Gap Detected',
          description: `The overall gender pay gap is ${gap.toFixed(1)}%. Female employees earn ${gap.toFixed(1)}% less than male employees on average.`,
          employeeCount: femaleData.count,
          employees: [],
          suggestedAction:
            'Run a detailed pay equity analysis to identify specific departments or levels with the largest gaps.',
          copilotPrompt: `The overall gender pay gap is ${gap.toFixed(1)}%. Can you break this down by department and level to identify where the gaps are largest?`,
        });
      }
    }

    // ── Nudge 5: Compa-ratio outliers ──
    const outliers = enriched.filter(
      (e) => e.compaRatio !== null && (e.compaRatio < 0.8 || e.compaRatio > 1.2),
    );
    if (outliers.length > 0) {
      nudges.push({
        id: 'nudge-compa-outlier',
        type: 'compa_ratio_outlier',
        severity: 'info',
        title: 'Compa-Ratio Outliers',
        description: `${outliers.length} employee${outliers.length > 1 ? 's have' : ' has'} compa-ratios outside the 0.80–1.20 range.`,
        employeeCount: outliers.length,
        employees: outliers.slice(0, 10).map((e) => ({
          id: e.id,
          name: e.name,
          department: e.department,
          level: e.level,
          salary: e.salary,
          compaRatio: e.compaRatio,
          performanceRating: e.performanceRating,
        })),
        suggestedAction:
          'Review positioning of extreme outliers — they may indicate misclassification or market misalignment.',
        copilotPrompt: `I have ${outliers.length} employees with extreme compa-ratios (below 0.80 or above 1.20). Can you help me understand which ones need attention?`,
      });
    }

    this.logger.log(`Generated ${nudges.length} nudges for tenant ${tenantId}`);
    return nudges;
  }
}
