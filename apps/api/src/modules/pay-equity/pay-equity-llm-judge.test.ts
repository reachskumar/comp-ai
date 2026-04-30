/**
 * Phase 1 LLM-as-judge eval harness for the Pay Equity narrative agent.
 *
 * This complements `pay-equity-evals.test.ts` (structural-only). For each
 * golden example we:
 *   1. Call the real narrative graph against the example's input.
 *   2. Ask a judge LLM (the same Azure OpenAI deployment the agents use)
 *      to score the output on accuracy / citationRate / methodology /
 *      tone, following the rubric's per-axis checks.
 *   3. Fail the CI run if any axis falls below the published thresholds.
 *
 * Skipped by default — set `RUN_LLM_EVALS=1` to run. Tests in this file
 * make real LLM calls and cost real money; they're meant to gate model
 * upgrades + prompt changes, not run on every PR.
 *
 * Thresholds (per the bible's eval-harness spec):
 *   accuracy            ≥ 0.90
 *   citationRate        = 1.00
 *   methodologyConsist  = 1.00
 *   tone                ≥ 0.80
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

interface GoldenExample {
  name: string;
  description: string;
  input: {
    tenantId?: string;
    userId?: string;
    analysisData?: unknown;
  };
  expectedCitationCount?: { min?: number; max?: number };
  expectedMethodology?: { name?: string; version?: string; dependentVariable?: string };
  expectedConfidence?: 'high' | 'medium' | 'low';
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

const SHOULD_RUN = process.env['RUN_LLM_EVALS'] === '1';

const THRESHOLDS = {
  accuracy: 0.9,
  citationRate: 1.0,
  methodologyConsistency: 1.0,
  tone: 0.8,
} as const;

type Axis = keyof typeof THRESHOLDS;

interface JudgeResult {
  axis: Axis;
  score: number;
  reasoning: string;
  failedChecks: string[];
}

const JUDGE_SYSTEM_PROMPT = `You are an evaluation judge for a Pay Equity narrative report. You score one axis at a time on a 0..1 scale where 1.0 = every check fully passed and 0.0 = every check fully failed.

Rules:
1. Be strict. A "mostly correct" answer that misses a numeric value or skips a citation is NOT 1.0 — score it lower with the missing item listed in failedChecks.
2. Return ONLY a JSON object with keys: score (number 0..1), reasoning (1-2 sentences), failedChecks (string[]).
3. The score must be the proportion of checks that fully passed. Round to 2 decimals.
4. Do not be lenient. Customer-facing reports require strict factual accuracy.

Return ONLY the JSON. No markdown.`;

function loadGoldens(): GoldenExample[] {
  const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'));
  return files.map((f) => JSON.parse(readFileSync(join(GOLDEN_DIR, f), 'utf-8')) as GoldenExample);
}

interface NarrativeOutput {
  narrative: string;
  citations: Array<{ type?: string; ref?: string; excerpt?: string }>;
  methodology?: { name?: string; version?: string; controls?: string[] };
  confidence?: string;
}

async function runNarrativeAgent(ex: GoldenExample): Promise<NarrativeOutput> {
  // Lazy-import @compensation/ai so the package isn't loaded when tests are skipped
  const ai = (await import('@compensation/ai')) as unknown as {
    invokePayEquityGraph: (input: {
      tenantId: string;
      userId: string;
      analysisData: unknown;
    }) => Promise<{
      report: { narrative?: string; citations?: NarrativeOutput['citations'] };
    }>;
  };

  const out = await ai.invokePayEquityGraph({
    tenantId: ex.input.tenantId ?? 'tenant-eval',
    userId: ex.input.userId ?? 'user-eval',
    analysisData: ex.input.analysisData,
  });

  return {
    narrative: out.report?.narrative ?? '',
    citations: out.report?.citations ?? [],
  };
}

async function judgeAxis(
  ex: GoldenExample,
  axis: Axis,
  output: NarrativeOutput,
): Promise<JudgeResult> {
  const ai = await import('@compensation/ai');
  const aiConfig = ai.loadAIConfig();
  const modelConfig = ai.resolveModelConfig(aiConfig, 'pay-equity');
  const model = await ai.createChatModel(aiConfig, modelConfig);

  const checks = ex.scoringRubric[axis]?.checks ?? [];
  const userPrompt = `Score the ${axis} axis for the Pay Equity narrative below. Use the checks list as your rubric — every check that fully passes counts as 1, partial passes count as 0.5, missing/wrong counts as 0. Return ONLY JSON: { score, reasoning, failedChecks }.

## Checks for "${axis}"
${checks.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Narrative
${output.narrative}

## Citations
${JSON.stringify(output.citations, null, 2)}

## Expected methodology
${JSON.stringify(ex.expectedMethodology ?? {}, null, 2)}

Return the JSON now.`;

  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const response = await model.invoke([
    new SystemMessage(JUDGE_SYSTEM_PROMPT),
    new HumanMessage(userPrompt),
  ]);

  const raw =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  const cleaned = raw
    .replace(/```json?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  let parsed: { score?: unknown; reasoning?: unknown; failedChecks?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return {
      axis,
      score: 0,
      reasoning: 'Could not parse judge response',
      failedChecks: ['judge_parse_error'],
    };
  }

  return {
    axis,
    score: typeof parsed.score === 'number' ? Math.max(0, Math.min(1, parsed.score)) : 0,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    failedChecks: Array.isArray(parsed.failedChecks)
      ? parsed.failedChecks.filter((c: unknown): c is string => typeof c === 'string')
      : [],
  };
}

const goldens = SHOULD_RUN ? loadGoldens() : [];

// Top-level skip: vitest will report "0 tests" instead of failing when the
// env var isn't set. Devs / CI opt-in by exporting RUN_LLM_EVALS=1.
describe.skipIf(!SHOULD_RUN)('Pay Equity LLM-as-judge harness (set RUN_LLM_EVALS=1 to run)', () => {
  describe.each(goldens)('$name', (ex) => {
    let output: NarrativeOutput;

    it('runs the narrative agent', async () => {
      output = await runNarrativeAgent(ex);
      expect(output.narrative.length).toBeGreaterThan(50);
    }, 60_000);

    const axes: Axis[] = ['accuracy', 'citationRate', 'methodologyConsistency', 'tone'];
    for (const axis of axes) {
      it(`scores ${axis} above the threshold`, async () => {
        const result = await judgeAxis(ex, axis, output);
         
        console.log(
          `  ${ex.name} · ${axis}: ${result.score.toFixed(2)} — ${result.reasoning}` +
            (result.failedChecks.length ? `\n    failed: ${result.failedChecks.join('; ')}` : ''),
        );
        expect(result.score).toBeGreaterThanOrEqual(THRESHOLDS[axis]);
      }, 60_000);
    }
  });
});

// Always-run sanity: the harness file must compile + load goldens regardless
// of whether we're actually running the LLM judge. Catches schema drift in
// the rubric without needing Azure access.
describe('LLM judge harness sanity', () => {
  it('discovers ≥5 golden examples with rubric coverage on all four axes', () => {
    const all = loadGoldens();
    expect(all.length).toBeGreaterThanOrEqual(5);
    for (const ex of all) {
      const axes = Object.keys(ex.scoringRubric);
      expect(axes).toContain('accuracy');
      expect(axes).toContain('citationRate');
      expect(axes).toContain('methodologyConsistency');
      expect(axes).toContain('tone');
    }
  });
});
