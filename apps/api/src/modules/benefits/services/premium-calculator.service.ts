import { Injectable, Logger } from '@nestjs/common';

export interface PremiumBreakdown {
  tier: string;
  totalPremium: number;
  employeePremium: number;
  employerPremium: number;
  employerContributionPct: number;
}

/**
 * Default employer contribution percentages by tier.
 * Employer pays more for employee-only, less for dependents.
 */
const DEFAULT_EMPLOYER_CONTRIBUTION: Record<string, number> = {
  EMPLOYEE: 0.8,           // 80% employer
  EMPLOYEE_SPOUSE: 0.7,    // 70% employer
  EMPLOYEE_CHILDREN: 0.75, // 75% employer
  FAMILY: 0.65,            // 65% employer
};

@Injectable()
export class PremiumCalculatorService {
  private readonly logger = new Logger(PremiumCalculatorService.name);

  /**
   * Calculate premium split for a given plan and tier.
   * @param premiums - Plan premium schedule { EMPLOYEE: 150, EMPLOYEE_SPOUSE: 350, ... }
   * @param tier - Selected tier
   * @param employerContributions - Optional custom employer contribution percentages
   */
  calculatePremium(
    premiums: Record<string, number>,
    tier: string,
    employerContributions?: Record<string, number>,
  ): PremiumBreakdown {
    const totalPremium = premiums[tier] ?? 0;
    const contributions = employerContributions ?? DEFAULT_EMPLOYER_CONTRIBUTION;
    const employerPct = contributions[tier] ?? 0.7;

    const employerPremium = Math.round(totalPremium * employerPct * 100) / 100;
    const employeePremium = Math.round((totalPremium - employerPremium) * 100) / 100;

    return {
      tier,
      totalPremium,
      employeePremium,
      employerPremium,
      employerContributionPct: Math.round(employerPct * 100),
    };
  }

  /**
   * Calculate premiums for all tiers of a plan.
   */
  calculateAllTiers(
    premiums: Record<string, number>,
    employerContributions?: Record<string, number>,
  ): PremiumBreakdown[] {
    return Object.keys(premiums).map((tier) =>
      this.calculatePremium(premiums, tier, employerContributions),
    );
  }

  /**
   * Calculate annual cost for an employee.
   */
  calculateAnnualCost(monthlyEmployeePremium: number): number {
    return Math.round(monthlyEmployeePremium * 12 * 100) / 100;
  }
}

