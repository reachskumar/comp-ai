/**
 * Pay Equity eval runner — Phase 0 scaffold.
 *
 * Loads golden examples and validates STRUCTURE only (output shape, citation
 * counts, methodology, warnings). Phase 1 will add LLM-as-judge scoring on
 * the accuracy + tone axes.
 *
 * Run via:
 *   pnpm --filter @compensation/ai exec vitest run src/evals/pay-equity/run.ts
 *
 * Phase 1 will wire `pnpm eval:pay-equity` as a CI gate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const GOLDEN_DIR = join(__dirname, 'golden');

interface GoldenExample {
  name: string;
  description: string;
  input: unknown;
  expectedOutputShape: Record<string, unknown>;
  expectedCitationCount?: { min?: number; max?: number };
  expectedMethodology?: { name?: string; version?: string; dependentVariable?: string };
  expectedConfidence?: 'high' | 'medium' | 'low';
  expectedWarnings?: string[];
  scoringRubric: Record<string, { weight: number; checks?: string[] }>;
}

function loadGolden(): GoldenExample[] {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'));
  return files.map((f) => JSON.parse(readFileSync(join(GOLDEN_DIR, f), 'utf-8')) as GoldenExample);
}

describe('Pay Equity eval — golden set structure', () => {
  const golden = loadGolden();

  it('loads at least the Phase 0 minimum (5 examples)', () => {
    expect(golden.length).toBeGreaterThanOrEqual(5);
  });

  describe.each(golden)('$name', (ex) => {
    it('has a non-empty description', () => {
      expect(ex.description.length).toBeGreaterThan(20);
    });

    it('rubric weights sum to 1.0 (±0.001)', () => {
      const total = Object.values(ex.scoringRubric).reduce((s, r) => s + r.weight, 0);
      expect(total).toBeCloseTo(1.0, 2);
    });

    it('input shape carries the required pay-equity fields', () => {
      const input = ex.input as { analysisData?: { regressionResults?: unknown[] } };
      expect(input.analysisData).toBeDefined();
      expect(Array.isArray(input.analysisData?.regressionResults)).toBe(true);
    });

    it('expected output shape declares at least executiveSummary + keyFindings', () => {
      expect(ex.expectedOutputShape['executiveSummary']).toBeDefined();
      expect(ex.expectedOutputShape['keyFindings']).toBeDefined();
    });
  });
});
