import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { MarketDataProvider } from '@compensation/database';

/**
 * Normalized salary band row — the common output format regardless of provider.
 */
export interface NormalizedBandRow {
  jobFamily: string;
  level: string;
  location?: string;
  currency: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  jobCode?: string;
}

/**
 * Provider-specific column mappings for CSV import.
 * Each provider exports data in a different format.
 */
interface ProviderColumnMap {
  jobFamily: string[];
  level: string[];
  location?: string[];
  currency?: string[];
  p10: string[];
  p25: string[];
  p50: string[];
  p75: string[];
  p90: string[];
  jobCode?: string[];
}

const PROVIDER_COLUMN_MAPS: Record<string, ProviderColumnMap> = {
  MERCER: {
    jobFamily: ['Job Family', 'Job Family Name', 'Function'],
    level: ['Level', 'Career Level', 'Grade'],
    location: ['Country', 'Location', 'Market'],
    currency: ['Currency', 'Curr'],
    p10: ['Base P10', 'Base 10th', 'Base Salary P10', 'TCC P10'],
    p25: ['Base P25', 'Base 25th', 'Base Salary P25', 'TCC P25'],
    p50: ['Base P50', 'Base 50th', 'Base Salary P50', 'Base Median', 'TCC P50'],
    p75: ['Base P75', 'Base 75th', 'Base Salary P75', 'TCC P75'],
    p90: ['Base P90', 'Base 90th', 'Base Salary P90', 'TCC P90'],
    jobCode: ['Job Code', 'Mercer Job Code', 'Position Code'],
  },
  WTW: {
    jobFamily: ['Position Family', 'Job Family', 'Function Name'],
    level: ['Grade', 'Level', 'WTW Grade'],
    location: ['Country', 'Region', 'Location'],
    currency: ['Currency'],
    p10: ['Base Salary P10', 'Fixed Pay P10', 'Total Rem P10'],
    p25: ['Base Salary P25', 'Fixed Pay P25', 'Total Rem P25', 'Q1'],
    p50: ['Base Salary P50', 'Fixed Pay P50', 'Total Rem P50', 'Median'],
    p75: ['Base Salary P75', 'Fixed Pay P75', 'Total Rem P75', 'Q3'],
    p90: ['Base Salary P90', 'Fixed Pay P90', 'Total Rem P90'],
    jobCode: ['Position Code', 'WTW Code'],
  },
  AON: {
    jobFamily: ['Job Family', 'Function'],
    level: ['Level', 'Band'],
    location: ['Country', 'Market'],
    currency: ['Currency'],
    p10: ['P10', '10th Percentile'],
    p25: ['P25', '25th Percentile', 'Q1'],
    p50: ['P50', '50th Percentile', 'Median'],
    p75: ['P75', '75th Percentile', 'Q3'],
    p90: ['P90', '90th Percentile'],
  },
  KORN_FERRY: {
    jobFamily: ['Job Family', 'Function', 'KF Family'],
    level: ['KF Grade', 'Hay Grade', 'Grade', 'Level'],
    location: ['Country', 'Market'],
    currency: ['Currency'],
    p10: ['Actual Salary P10', 'Reference Salary P10', 'P10'],
    p25: ['Actual Salary P25', 'Reference Salary P25', 'P25'],
    p50: ['Actual Salary P50', 'Reference Salary P50', 'Median', 'P50'],
    p75: ['Actual Salary P75', 'Reference Salary P75', 'P75'],
    p90: ['Actual Salary P90', 'Reference Salary P90', 'P90'],
  },
  PAYSCALE: {
    jobFamily: ['Job Title', 'Job Family'],
    level: ['Level', 'Experience Level', 'Years Experience'],
    location: ['Metro Area', 'City', 'Location'],
    currency: ['Currency'],
    p10: ['10th Percentile', 'P10'],
    p25: ['25th Percentile', 'P25'],
    p50: ['Median', '50th Percentile', 'P50'],
    p75: ['75th Percentile', 'P75'],
    p90: ['90th Percentile', 'P90'],
  },
  SALARY_COM: {
    jobFamily: ['Job Family', 'CompAnalyst Job Family'],
    level: ['Scope', 'Level', 'Grade'],
    location: ['Location', 'Metro', 'Country'],
    currency: ['Currency'],
    p10: ['Base P10', '10th'],
    p25: ['Base P25', '25th'],
    p50: ['Base P50', 'Median'],
    p75: ['Base P75', '75th'],
    p90: ['Base P90', '90th'],
    jobCode: ['CompAnalyst Code', 'Job Code'],
  },
};

/**
 * Market Data Import Service
 *
 * Parses CSV files from various market data providers (Mercer, WTW, Aon,
 * Korn Ferry, PayScale, Salary.com) and normalizes them into SalaryBand records.
 */
@Injectable()
export class MarketDataImportService {
  private readonly logger = new Logger(MarketDataImportService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Get supported provider names and their expected column formats.
   */
  getSupportedProviders() {
    return Object.keys(PROVIDER_COLUMN_MAPS).map((key) => ({
      id: key,
      name: this.providerDisplayName(key),
      expectedColumns: PROVIDER_COLUMN_MAPS[key],
    }));
  }

  /**
   * Parse CSV text from a specific provider and return normalized band rows.
   */
  parseCSV(
    csvText: string,
    provider: string,
    defaultCurrency = 'USD',
  ): { bands: NormalizedBandRow[]; warnings: string[]; skipped: number } {
    const columnMap = PROVIDER_COLUMN_MAPS[provider];
    if (!columnMap) {
      // Fallback: try generic column names
      return this.parseGenericCSV(csvText, defaultCurrency);
    }

    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) {
      throw new BadRequestException('CSV must have at least a header row and one data row');
    }

    const headers = lines[0]!.split(',').map((h) => h.trim().toLowerCase());

    // Resolve a column index from an array of possible header names
    const resolve = (possibleNames: string[]): number => {
      for (const name of possibleNames) {
        const idx = headers.indexOf(name.toLowerCase());
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const jobFamilyIdx = resolve(columnMap.jobFamily);
    const levelIdx = resolve(columnMap.level);
    const p10Idx = resolve(columnMap.p10);
    const p25Idx = resolve(columnMap.p25);
    const p50Idx = resolve(columnMap.p50);
    const p75Idx = resolve(columnMap.p75);
    const p90Idx = resolve(columnMap.p90);
    const locationIdx = columnMap.location ? resolve(columnMap.location) : -1;
    const currencyIdx = columnMap.currency ? resolve(columnMap.currency) : -1;
    const jobCodeIdx = columnMap.jobCode ? resolve(columnMap.jobCode) : -1;

    // Validate required columns found
    if (jobFamilyIdx < 0 || levelIdx < 0 || p50Idx < 0) {
      throw new BadRequestException(
        `Could not find required columns for ${provider}. Expected: ` +
          `jobFamily (${columnMap.jobFamily.join('/')}), ` +
          `level (${columnMap.level.join('/')}), ` +
          `p50 (${columnMap.p50.join('/')}). ` +
          `Found headers: ${headers.join(', ')}`,
      );
    }

    const bands: NormalizedBandRow[] = [];
    const warnings: string[] = [];
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCSVRow(lines[i]!);
      if (cols.length === 0 || cols.every((c) => !c.trim())) {
        skipped++;
        continue;
      }

      const jobFamily = cols[jobFamilyIdx]?.trim();
      const level = cols[levelIdx]?.trim();
      const p50 = this.parseNumber(cols[p50Idx]);

      if (!jobFamily || !level || isNaN(p50) || p50 <= 0) {
        warnings.push(`Row ${i + 1}: Missing job family, level, or invalid P50 — skipped`);
        skipped++;
        continue;
      }

      bands.push({
        jobFamily,
        level,
        location: locationIdx >= 0 ? cols[locationIdx]?.trim() || undefined : undefined,
        currency: currencyIdx >= 0 ? cols[currencyIdx]?.trim() || defaultCurrency : defaultCurrency,
        p10: this.parseNumber(cols[p10Idx]) || p50 * 0.7,
        p25: this.parseNumber(cols[p25Idx]) || p50 * 0.85,
        p50,
        p75: this.parseNumber(cols[p75Idx]) || p50 * 1.15,
        p90: this.parseNumber(cols[p90Idx]) || p50 * 1.3,
        jobCode: jobCodeIdx >= 0 ? cols[jobCodeIdx]?.trim() : undefined,
      });
    }

    this.logger.log(
      `Parsed ${bands.length} bands from ${provider} CSV (${skipped} skipped, ${warnings.length} warnings)`,
    );

    return { bands, warnings, skipped };
  }

  /**
   * Import parsed bands into the database, linking to a MarketDataSource.
   */
  async importBands(
    tenantId: string,
    sourceId: string,
    bands: NormalizedBandRow[],
    surveyDate?: Date,
  ) {
    const results = await this.db.forTenant(tenantId, async (tx) => {
      const created = [];
      for (const band of bands) {
        created.push(
          await (tx.salaryBand.create as any)({
            data: {
              tenantId,
              jobFamily: band.jobFamily,
              level: band.level,
              location: band.location,
              currency: band.currency,
              p10: band.p10,
              p25: band.p25,
              p50: band.p50,
              p75: band.p75,
              p90: band.p90,
              source: band.jobCode || undefined,
              sourceId,
              surveyDate: surveyDate || undefined,
              effectiveDate: new Date(),
            },
          }),
        );
      }

      // Update source lastSyncAt
      await (tx.marketDataSource.update as any)({
        where: { id: sourceId },
        data: { lastSyncAt: new Date(), surveyDate: surveyDate || undefined },
      });

      return created;
    });

    this.logger.log(
      `Imported ${results.length} salary bands for source ${sourceId} in tenant ${tenantId}`,
    );

    return { imported: results.length, bands: results };
  }

  // ─── Generic CSV parser (for CUSTOM/RADFORD) ───────────────────

  private parseGenericCSV(
    csvText: string,
    defaultCurrency: string,
  ): { bands: NormalizedBandRow[]; warnings: string[]; skipped: number } {
    // Use a generic mapping that tries common column names
    const genericMap: ProviderColumnMap = {
      jobFamily: ['Job Family', 'Function', 'Category', 'Department'],
      level: ['Level', 'Grade', 'Band', 'Tier'],
      location: ['Location', 'Country', 'Region', 'City'],
      currency: ['Currency', 'Curr'],
      p10: ['P10', '10th', '10th Percentile'],
      p25: ['P25', '25th', '25th Percentile', 'Q1'],
      p50: ['P50', 'Median', '50th', '50th Percentile'],
      p75: ['P75', '75th', '75th Percentile', 'Q3'],
      p90: ['P90', '90th', '90th Percentile'],
    };

    // Temporarily add as CUSTOM and recurse
    const originalMap = PROVIDER_COLUMN_MAPS['_GENERIC'];
    PROVIDER_COLUMN_MAPS['_GENERIC'] = genericMap;
    try {
      return this.parseCSV(csvText, '_GENERIC', defaultCurrency);
    } finally {
      if (originalMap) {
        PROVIDER_COLUMN_MAPS['_GENERIC'] = originalMap;
      } else {
        delete PROVIDER_COLUMN_MAPS['_GENERIC'];
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private parseCSVRow(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  private parseNumber(value: string | undefined): number {
    if (!value) return NaN;
    // Remove currency symbols, commas, spaces
    const cleaned = value.replace(/[$€£¥₹,\s]/g, '').trim();
    return Number(cleaned);
  }

  private providerDisplayName(key: string): string {
    const names: Record<string, string> = {
      MERCER: 'Mercer',
      WTW: 'Willis Towers Watson (WTW)',
      AON: 'Aon / McLagan',
      KORN_FERRY: 'Korn Ferry (Hay)',
      PAYSCALE: 'PayScale',
      SALARY_COM: 'Salary.com / CompAnalyst',
      RADFORD: 'Radford (Aon)',
      COMP_ANALYST: 'CompAnalyst',
      CUSTOM: 'Custom Format',
    };
    return names[key] || key;
  }
}
