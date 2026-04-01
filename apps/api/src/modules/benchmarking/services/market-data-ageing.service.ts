import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database';

/**
 * Ageing adjustment result for a salary band
 */
export interface AgedBandValues {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  ageingFactor: number;
  monthsSinceSurvey: number;
}

/**
 * Blended market data result from multiple sources
 */
export interface BlendedBandResult {
  jobFamily: string;
  level: string;
  location?: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  sources: Array<{
    sourceId: string;
    sourceName: string;
    provider: string;
    weight: number;
    agedValues: AgedBandValues;
  }>;
}

/**
 * Market Data Ageing & Blending Service
 *
 * Handles two critical market data operations:
 *
 * 1. **Ageing**: Survey data gets stale over time. This service applies
 *    time-based adjustments using the formula:
 *    adjusted_value = survey_value × (1 + annual_movement% × months_since_survey/12)
 *
 * 2. **Blending**: When multiple providers have data for the same job/level,
 *    this service produces weighted averages:
 *    blended_p50 = Σ(weight_i × provider_i_p50) / Σ(weight_i)
 */
@Injectable()
export class MarketDataAgeingService {
  private readonly logger = new Logger(MarketDataAgeingService.name);

  /** Default annual market movement rate (3.5%) */
  private readonly DEFAULT_AGEING_RATE = 0.035;

  constructor(private readonly db: DatabaseService) {}

  /**
   * Apply ageing adjustment to raw survey values.
   *
   * Formula: adjusted = value × (1 + annualRate × monthsSince / 12)
   *
   * @param values - Raw percentile values from survey
   * @param surveyDate - When the survey data was collected
   * @param annualRate - Annual market movement rate (e.g., 0.035 = 3.5%)
   * @param asOfDate - Date to age to (default: now)
   */
  applyAgeing(
    values: { p10: number; p25: number; p50: number; p75: number; p90: number },
    surveyDate: Date,
    annualRate?: number,
    asOfDate?: Date,
  ): AgedBandValues {
    const rate = annualRate ?? this.DEFAULT_AGEING_RATE;
    const now = asOfDate ?? new Date();
    const monthsSinceSurvey = this.monthsBetween(surveyDate, now);
    const ageingFactor = 1 + rate * (monthsSinceSurvey / 12);

    return {
      p10: Math.round(values.p10 * ageingFactor * 100) / 100,
      p25: Math.round(values.p25 * ageingFactor * 100) / 100,
      p50: Math.round(values.p50 * ageingFactor * 100) / 100,
      p75: Math.round(values.p75 * ageingFactor * 100) / 100,
      p90: Math.round(values.p90 * ageingFactor * 100) / 100,
      ageingFactor,
      monthsSinceSurvey,
    };
  }

  /**
   * Blend salary data from multiple sources using weighted averages.
   *
   * Formula: blended_pX = Σ(weight_i × pX_i) / Σ(weight_i)
   *
   * @param sources - Array of source data with weights and aged values
   */
  blendSources(
    jobFamily: string,
    level: string,
    sources: Array<{
      sourceId: string;
      sourceName: string;
      provider: string;
      weight: number;
      agedValues: AgedBandValues;
    }>,
    location?: string,
  ): BlendedBandResult {
    if (sources.length === 0) {
      return {
        jobFamily,
        level,
        location,
        p10: 0,
        p25: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        sources: [],
      };
    }

    if (sources.length === 1) {
      const s = sources[0]!;
      return {
        jobFamily,
        level,
        location,
        ...s.agedValues,
        sources,
      };
    }

    const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);

    const blend = (key: 'p10' | 'p25' | 'p50' | 'p75' | 'p90') =>
      Math.round(
        (sources.reduce((sum, s) => sum + s.weight * s.agedValues[key], 0) / totalWeight) * 100,
      ) / 100;

    return {
      jobFamily,
      level,
      location,
      p10: blend('p10'),
      p25: blend('p25'),
      p50: blend('p50'),
      p75: blend('p75'),
      p90: blend('p90'),
      sources,
    };
  }

  /**
   * Get blended market data for a specific job family / level / location.
   * Queries all active sources, applies ageing, and blends with weights.
   */
  async getBlendedMarketData(
    tenantId: string,
    jobFamily: string,
    level: string,
    location?: string,
  ): Promise<BlendedBandResult | null> {
    // Query all salary bands for this job family/level, grouped by source
    const where: Record<string, unknown> = {
      tenantId,
      jobFamily,
      level,
    };
    if (location) where['location'] = location;

    // Query salary bands and their related market sources
    const bands = await this.db.forTenant(tenantId, async (tx) => {
      const results = await (tx.salaryBand.findMany as any)({
        where,
        include: { marketSource: true },
      });
      return results as Array<{
        id: string;
        p10: { toNumber?: () => number } | number;
        p25: { toNumber?: () => number } | number;
        p50: { toNumber?: () => number } | number;
        p75: { toNumber?: () => number } | number;
        p90: { toNumber?: () => number } | number;
        source: string | null;
        sourceId: string | null;
        surveyDate: Date | null;
        effectiveDate: Date;
        marketSource: {
          name: string;
          provider: string;
          ageingRate: { toNumber?: () => number } | number | null;
          blendWeight: { toNumber?: () => number } | number | null;
        } | null;
      }>;
    });

    if (bands.length === 0) return null;

    const toNum = (v: { toNumber?: () => number } | number | null): number => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      return v.toNumber ? v.toNumber() : Number(v);
    };

    // Group by source and compute aged values
    const sourceMap = new Map<
      string,
      {
        sourceId: string;
        sourceName: string;
        provider: string;
        weight: number;
        bands: typeof bands;
      }
    >();

    for (const band of bands) {
      const sourceId = band.sourceId || 'manual';
      if (!sourceMap.has(sourceId)) {
        sourceMap.set(sourceId, {
          sourceId,
          sourceName: band.marketSource?.name || 'Manual',
          provider: band.marketSource?.provider || 'MANUAL',
          weight: band.marketSource?.blendWeight ? toNum(band.marketSource.blendWeight) : 1,
          bands: [],
        });
      }
      sourceMap.get(sourceId)!.bands.push(band);
    }

    // For each source, pick the most recent band and apply ageing
    const sources = Array.from(sourceMap.values()).map((group) => {
      // Pick the most recent band from this source
      const mostRecent = group.bands.sort(
        (a, b) => new Date(b.effectiveDate).getTime() - new Date(a.effectiveDate).getTime(),
      )[0]!;

      const rawValues = {
        p10: toNum(mostRecent.p10),
        p25: toNum(mostRecent.p25),
        p50: toNum(mostRecent.p50),
        p75: toNum(mostRecent.p75),
        p90: toNum(mostRecent.p90),
      };

      const surveyDate = mostRecent.surveyDate || mostRecent.effectiveDate;
      const ageingRate = mostRecent.marketSource?.ageingRate
        ? toNum(mostRecent.marketSource.ageingRate)
        : undefined;

      const agedValues = this.applyAgeing(rawValues, surveyDate, ageingRate);

      return {
        sourceId: group.sourceId,
        sourceName: group.sourceName,
        provider: group.provider,
        weight: group.weight,
        agedValues,
      };
    });

    return this.blendSources(jobFamily, level, sources, location);
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private monthsBetween(from: Date, to: Date): number {
    const yearDiff = to.getFullYear() - from.getFullYear();
    const monthDiff = to.getMonth() - from.getMonth();
    const dayFraction = (to.getDate() - from.getDate()) / 30;
    return Math.max(0, yearDiff * 12 + monthDiff + dayFraction);
  }
}
