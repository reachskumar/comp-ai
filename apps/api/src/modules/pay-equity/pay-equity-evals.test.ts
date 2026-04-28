/**
 * Phase 0 Pay Equity eval harness — STRUCTURAL validation of the golden set.
 *
 * Loads every example from `packages/ai/src/evals/pay-equity/golden/*.json`
 * and asserts the contract shape so accidental schema drift trips a test.
 *
 * Phase 1 expands this with LLM-as-judge scoring of accuracy / tone /
 * citation rate against the actual narrative agent output.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

interface GoldenExample {
  name: string;
  description: string;
  input: { analysisData?: { regressionResults?: unknown[] } };
  expectedOutputShape: Record<string, unknown>;
  expectedCitationCount?: { min?: number; max?: number };
  expectedMethodology?: { name?: string; version?: string; dependentVariable?: string };
  expectedConfidence?: 'high' | 'medium' | 'low';
  expectedWarnings?: string[];
  scoringRubric: Record<string, { weight: number; checks?: string[] }>;
}

const GOLDEN_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'ai',
  'src',
  'evals',
  'pay-equity',
  'golden',
);

function loadGolden(): GoldenExample[] {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'));
  return files.map((f) => JSON.parse(readFileSync(join(GOLDEN_DIR, f), 'utf-8')) as GoldenExample);
}

describe('Pay Equity eval harness (Phase 0 scaffold)', () => {
  const golden = loadGolden();

  it('loads the Phase 0 minimum of 5 golden examples', () => {
    expect(golden.length).toBeGreaterThanOrEqual(5);
  });

  describe.each(golden)('$name', (ex) => {
    it('has a description over 20 chars', () => {
      expect(ex.description.length).toBeGreaterThan(20);
    });

    it('rubric weights sum to 1.0 ± 0.001', () => {
      const total = Object.values(ex.scoringRubric).reduce((s, r) => s + r.weight, 0);
      expect(total).toBeCloseTo(1.0, 2);
    });

    it('input has analysisData with regressionResults array', () => {
      expect(ex.input.analysisData).toBeDefined();
      expect(Array.isArray(ex.input.analysisData?.regressionResults)).toBe(true);
    });

    it('expectedOutputShape declares executiveSummary + keyFindings', () => {
      expect(ex.expectedOutputShape['executiveSummary']).toBeDefined();
      expect(ex.expectedOutputShape['keyFindings']).toBeDefined();
    });

    it('every regressionResult declares pValue and sampleSize', () => {
      const recs =
        (ex.input.analysisData?.regressionResults as Array<Record<string, unknown>> | undefined) ??
        [];
      for (const r of recs) {
        expect(typeof r['pValue']).toBe('number');
        expect(typeof r['sampleSize']).toBe('number');
      }
    });
  });

  it('exercises sample-size guard: at least one example has n < 30 to test the warning path', () => {
    const hasLowSample = golden.some((ex) => {
      const recs =
        (ex.input.analysisData?.regressionResults as Array<{ sampleSize: number }> | undefined) ??
        [];
      return recs.some((r) => r.sampleSize < 30);
    });
    expect(hasLowSample).toBe(true);
  });

  it('exercises EDGE compliance fail path: at least one example expects status=fail or mixed', () => {
    const hasFail = golden.some((ex) => {
      const status = ex.expectedOutputShape['edgeComplianceStatus'];
      return status === 'fail' || status === 'mixed';
    });
    expect(hasFail).toBe(true);
  });
});
