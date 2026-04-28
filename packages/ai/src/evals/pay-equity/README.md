# Pay Equity Eval Harness

Evals for the Pay Equity AI agents. **Read `PAY_EQUITY_CONTEXT.md` § 2 (Architecture / Eval harness) before adding evals.**

## Goal

Detect drift in agent output quality across model upgrades, prompt changes,
or methodology revisions. Pay Equity reports are board-facing artifacts —
silent regressions cost trust. The harness gates LLM/prompt changes.

## Scoring axes

| Axis                        | What it checks                                                                      | Pass threshold |
| --------------------------- | ----------------------------------------------------------------------------------- | -------------- |
| **Accuracy**                | Does the narrative match the input data? Numbers cited match coefficients/p-values? | 90%            |
| **Citation rate**           | % of factual claims backed by `citations[]`                                         | 100%           |
| **Methodology consistency** | Same methodology version cited for the same input                                   | 100%           |
| **Tone**                    | Board-grade, no LLM filler ("As an AI...", excessive hedging, etc.)                 | 85%            |

## Layout

```
evals/pay-equity/
  README.md                     # this file
  golden/
    narrative-001-typical.json  # standard cycle, gender-only
    narrative-002-no-gap.json   # null result (gap < threshold)
    narrative-003-large-pop.json
    narrative-004-small-pop.json   # tests sample-size warnings
    narrative-005-edge-fail.json   # gap exceeds EDGE threshold
  run.ts                        # Vitest entry point (Phase 0.4 stub)
  rubrics/
    narrative.ts                # LLM-as-judge rubric
```

## Phase 0 status

Scaffolding only. Phase 1 expands to 20 examples and wires `pnpm eval:pay-equity`
into CI as a pre-PR gate.

## How a golden example is structured

```jsonc
{
  "name": "narrative-001-typical",
  "description": "Standard 500-employee tenant with a 3.2% adjusted gender gap",
  "input": {
    /* PayEquityAnalysisInput shape */
  },
  "expectedOutputShape": {
    "executiveSummary": { "minLength": 200, "shouldContain": ["3.2%", "gender"] },
    "edgeComplianceStatus": "pass", // gap is within ±5%
    "keyFindings": { "minCount": 3 },
    "remediationRecommendations": { "minCount": 1 },
  },
  "expectedCitationCount": { "min": 4 },
  "expectedMethodology": { "name": "edge-multivariate", "version": "2026.04" },
  "scoringRubric": {
    /* per-axis rubric */
  },
}
```
