# PAY_EQUITY_CONTEXT.md — Pay Equity Build Bible

> **Living doc.** Source of truth for the Pay Equity feature arc.
> **Read this first** before any Pay Equity work.
> **Update the relevant section at the end of every session.**
>
> Companion docs: `PRODUCTION_PLAN.md` (whole-product roadmap), `context.md` (engineering ground-truth).

---

## 0 — Quick Start

**One-paragraph vision:** Pay Equity is the wedge feature for our HRIS-agnostic AI add-on. The buyer is the CHRO. The artifact is a board-ready narrative that explains gaps, recommends remediation, and exports statutory reports (EU PTD, UK GPG, EEO-1, CA SB 1162). What competitors (Trusaic, Syndio, Compa) ship as quarterly PDFs, we ship as a daily, AI-narrated, action-oriented workspace. Built on top of any HRIS via a canonical schema; everything cites its sources; methodology is versioned and auditable.

**Where we are:**

- ✅ Phase 0 (Foundation) shipped — module, contract, persistence, audit, methodology version, eval harness, workspace shell
- ✅ Phase 1 (Diagnose) shipped — trend, cohort matrix, drill-down, outliers
- ✅ Phase 1.5 (AI agents) shipped — cohort root-cause + outlier explainer
- ✅ Phase 2 (Remediate) shipped — deterministic adjustments + AI narrative + decide + apply (writeback)
- ✅ Phase 3 (Report) first cut shipped — board PDF + EU PTD + UK GPG + EEO-1 + CA SB 1162 + auditor PDF
- ⬜ Phase 4 (Predict & Prevent), Phase 5 (Trust), Phase 6 (Self-service & Polish)
- ⬜ Phase 2.4 (multi-quarter plan generator) and Phase 2.6 (remediation letters) deferred
- ⬜ Phase 3.6 (comp committee deck generator) and 3.7 (scheduled delivery) deferred
- ⬜ Statutory CSV mappings (bonus, hourly rate, quartiles, race/ethnicity, job category) need canonical-schema additions and a comp-lawyer review pass before customer filing
- ⬜ LLM-as-judge eval scoring still deferred (needs OpenAI key in CI)

**What's next (Phase 4 — Predict & Prevent, ~1 week):**

1. Forward-looking 12-month gap projection (new graph)
2. Hiring impact modeler ("if we hire 50 ICs...")
3. Promotion slate equity check (auto-runs on cycle's promo list)
4. Pay band drift detector
5. AIR (80% rule) tracking
6. In-cycle warning at manager workspace (hooks /comp-cycles/my-team)
7. Real-time pre-offer guardrail

---

## 1 — Vision & Positioning

### What we're building

A Pay Equity workspace that:

- Reads any HRIS data via the canonical comp schema
- Diagnoses gaps with statistical rigor + AI narrative
- Recommends remediation with cost-to-close + per-employee adjustments
- Exports every required statutory report
- Predicts forward gap from hiring/promo patterns
- Prevents tomorrow's gap with in-cycle warnings

### Who's the buyer

**Primary:** CHRO. They own the board-level pay equity narrative and the regulatory exposure.
**Secondary:** HRBPs (operate the diagnostic + remediation loop).
**Tertiary:** Comp committee (consume the report quarterly).
**Self-service users:** Managers (in-cycle warnings), Employees (personal equity statement).

### Why now (regulatory tailwind)

- **EU Pay Transparency Directive** — enforced June 2026. Every EU operating company must report. _Few vendors have a clean export today._
- **UK Gender Pay Gap** — annual filing for any UK employer with 250+ staff
- **California SB 1162** — pay range publication required since 2023
- **NYC pay transparency** — required since 2022
- **Colorado Equal Pay Act** — required
- **EEO-1 Component 1** — federal contractor requirement
- **Pending US federal pay equity disclosure** — Biden EO direction; may codify soon

### Strategic wedge vs competitors

| Vendor              | What they do                                   | Where we beat them                                            |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| **Trusaic**         | Quarterly statistical reports + EEO-1 service  | We're daily, AI-narrated, embedded in comp decisions          |
| **Syndio**          | Real-time monitoring + remediation suggestions | We close the loop with cycle writeback + Letters              |
| **Compa**           | Market data + compa-ratio analytics            | We do the equity narrative + statutory exports                |
| **Workday/Lattice** | Built-in but shallow equity views              | We're vendor-agnostic; one tool covers all their HRIS choices |

**Defensible moat:**

1. Domain-specific AI prompts + eval harness (not generic LLM calls)
2. Citations on every claim (regression coefficients, employee IDs, policy lines)
3. Vendor-agnostic canonical schema
4. Closed-loop integration (analysis → remediation → cycle writeback → letters)
5. Methodology versioning (auditor-defensible)

---

## 2 — Architecture

### Module structure (target after Phase 0)

```
apps/api/src/modules/pay-equity/
  ├── pay-equity.module.ts
  ├── pay-equity.controller.ts        # workspace endpoints
  ├── pay-equity.service.ts           # orchestration
  ├── services/
  │   ├── analysis.service.ts         # statistical + AI runs
  │   ├── cohort.service.ts           # multi-dim drill-down
  │   ├── remediation.service.ts      # cost-to-close + suggestions
  │   ├── report.service.ts           # statutory exports
  │   └── prevention.service.ts       # in-cycle / pre-decision checks
  ├── dto/
  └── pay-equity.test.ts

packages/ai/src/graphs/
  ├── pay-equity-graph.ts             # EXISTS: narrative report
  ├── pay-equity-cohort-graph.ts      # NEW: cohort root-cause
  ├── pay-equity-remediation-graph.ts # NEW: optimization solver + narrative
  └── pay-equity-projection-graph.ts  # NEW: 12-month forecast

apps/web/src/app/(dashboard)/dashboard/pay-equity/
  ├── page.tsx                        # workspace shell (5 tabs)
  ├── overview/
  ├── diagnose/
  ├── remediate/
  ├── reports/
  └── prevent/
```

### Canonical data model

Required tables/fields the canonical schema must hold:

- `Employee`: id, tenantId, gender, race?, ethnicity?, age, level, department, location, jobFamily, hireDate, terminationDate, baseSalary, totalComp, currency, performanceRating, compaRatio, salaryBandId, managerId
- `CompComponent`: granular (base, bonus, equity, allowance, etc.) — needed for "total compensation" gap analysis vs "base salary" gap
- `PayEquityRun` _(new)_: id, tenantId, runAt, methodology version, controls used, cohort scope, model+model version used, result JSON, runByUserId
- `PayEquityRemediation` _(new)_: id, runId, employeeId, fromValue, toValue, justification, status (PROPOSED → APPROVED → APPLIED), appliedCycleId
- `PayEquityCohortSnapshot` _(new, optional)_: time-series storage for 8-quarter trend without re-running history

### AI agent contract (must enforce in Phase 0)

Every PE agent MUST return:

```ts
interface PayEquityAgentResult<T> {
  output: T; // structured data + narrative
  citations: Citation[]; // every claim must be backed
  methodology: {
    name: string; // e.g. "EDGE-multivariate-v2"
    version: string;
    controls: string[]; // e.g. ['level','tenure','location','perf']
    sampleSize: number;
    confidenceInterval: number;
  };
  confidence: 'high' | 'medium' | 'low';
  warnings: string[]; // sample-size, missing-data, etc.
  runId: string; // FK to PayEquityRun
}

interface Citation {
  type:
    | 'employee_row'
    | 'policy_line'
    | 'regression_coefficient'
    | 'cohort_query'
    | 'external_source';
  ref: string; // ID, line number, query hash, URL
  excerpt?: string; // optional snippet
}
```

### Privacy & PII rules

- **k-anonymity:** never report on a cohort with `n < 5`. UI greys out + tooltips explain.
- **Race/ethnicity:** optional input. UI degrades gracefully — gender-only analysis if race data is absent. Never fabricate.
- **Compensation values in narratives:** redact specific salaries when sample is < 30; use ranges/medians instead.
- **Auditor exports:** strip employee identifiers; provide hashed IDs only.

### Eval harness

- Location: `packages/ai/evals/pay-equity/`
- Per agent: `golden/<agent>.json` with `[{input, expectedOutputShape, scoringRubric}]`
- Run on PR via `pnpm eval:pay-equity`
- Score on:
  - **Accuracy:** does the narrative match the input data? (LLM-as-judge with strict rubric)
  - **Citation rate:** % of factual claims backed by `citations[]`
  - **Methodology consistency:** is the same methodology version cited for the same input?
  - **Tone:** board-grade, no hedging, no LLM filler
- Pass threshold: 90% on accuracy, 100% on citation rate, 100% on methodology consistency

---

## 3 — Methodology

### Statistical approach

- **Primary:** OLS regression of `log(baseSalary)` on protected class indicator + controls
- **Controls:** level, tenure (months), location, jobFamily, performanceRating
- **Output:** β coefficient on protected class, p-value, 95% CI
- **Adjusted gap = exp(β) - 1** (interpreted as % difference)
- **Unadjusted gap = (median_male - median_female) / median_male** (raw)
- **Sample size warnings:** never report when n<30 in any cohort being compared

### EDGE Certified methodology adherence

- Existing prompt claims EDGE methodology
- TODO Phase 0: validate prompt against actual EDGE specification
- TODO Phase 5: track methodology version per run for audit

### Multi-dim cohort

- Always start with single-dim (gender, race, age band)
- Drill: gender × level, gender × dept, gender × location
- Triple-cross only when each cell n≥30 (rarely possible — flag clearly)

### Remediation optimization

- **Objective:** minimize total cost
- **Constraints:**
  - resulting adjusted gap ≤ target (e.g., 2%)
  - no employee adjustment exceeds X% of base (configurable)
  - resulting compa-ratio stays within band
  - budget cap respected
- **Solver:** linear programming (use `glpk` or similar) — can fall back to greedy for MVP
- **AI layer:** generates the narrative justification per adjustment

### Open methodology questions (need expert review before Phase 3 ships)

- ⚠️ Is `log(salary)` regression sufficient or do we need quantile regression for distributional gaps?
- ⚠️ Should controls vary by jurisdiction (UK GPG specifies certain breakdowns)?
- ⚠️ How do we handle intersectional cohorts (gender × race) with small n?
- ⚠️ Should we offer Oaxaca-Blinder decomposition for gap-driver attribution?

---

## 4 — Phase plan

### Phase 0 — Foundation _(shipped 2026-04-28)_

| #   | Task                                                                                                                  | Status | File refs                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| 0.1 | New `pay-equity` API module _alongside_ the existing analytics one (legacy untouched per "stop breaking things")      | ✅     | apps/api/src/modules/pay-equity/                                                             |
| 0.2 | `PayEquityRun` + `PayEquityRemediation` Prisma models + migration SQL (additive, not yet applied to prod)             | ✅     | packages/database/prisma/schema.prisma · migrations/20260428151213_add_pay_equity_models/    |
| 0.3 | AI agent contract types: `PayEquityAgentResult<T>` with citations + methodology + confidence + warnings               | ✅     | packages/ai/src/types/pay-equity.ts                                                          |
| 0.4 | Eval harness scaffold + 5 golden examples + structural validation tests                                               | ✅     | packages/ai/src/evals/pay-equity/ + apps/api/src/modules/pay-equity/pay-equity-evals.test.ts |
| 0.5 | Workspace shell at `/dashboard/pay-equity` (5 tabs + status bar) — _alongside_ legacy analyzer page, not replacing it | ✅     | apps/web/src/app/(dashboard)/dashboard/pay-equity/                                           |
| 0.6 | Methodology versioning (every run stamps name + version) + audit log writes (action=PAY_EQUITY_RUN)                   | ✅     | pay-equity.service.ts                                                                        |

**Phase 0 demo state:**

- Legacy analyzer page at `/dashboard/analytics/pay-equity` and EDGE flow still work unchanged
- New workspace at `/dashboard/pay-equity` with 5-tab shell: Overview wired, Diagnose/Remediate/Reports/Prevent placeholders that name their phase
- Status bar pulls from `GET /api/v1/pay-equity/overview` (latest run + delta vs previous)
- "Run analysis" persists a `PayEquityRun` row with the full envelope, writes an `AuditLog` row, returns the envelope to the client
- Eval harness has 5 golden examples (typical, no-gap, edge-fail, small-sample, multi-dim) + 28 structural assertions
- 7 service unit tests (PENDING→COMPLETE persistence, envelope shape, audit row, k-anonymity warning, FAILED on throw, overview headline + delta)

**Migration to apply** (manual step, not auto-run): `pnpm db:migrate` to apply `20260428151213_add_pay_equity_models`.

### Phase 1 — Diagnose _(shipped 2026-04-28)_

| #   | Feature                                            | Status | Notes                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Status bar (4 KPI cards)                           | ✅     | Shipped in Phase 0; pulls from `GET /pay-equity/overview`                                                                                                                                                                                                                                          |
| 1.2 | Trend chart (last N runs, methodology-shift flags) | ✅     | `GET /pay-equity/trend?dimension&limit`; oldest→newest series; bar chart with shift indicator                                                                                                                                                                                                      |
| 1.3 | Multi-dim cohort matrix (heatmap)                  | ✅     | `GET /pay-equity/runs/:id/cohorts`; severity-tinted clickable cells grouped by dimension; suppressed cells render as n<5 stub                                                                                                                                                                      |
| 1.4 | Cohort drill-down to employee rows                 | ✅     | `GET /pay-equity/runs/:id/cohorts/:dim/:group`; k-anonymity gate; 50-row default with truncated flag                                                                                                                                                                                               |
| 1.5 | Cohort root-cause AI agent                         | ✅     | Shipped 2026-04-28. `POST /pay-equity/runs/:id/cohorts/:dim/:group/root-cause`. Service pre-computes by-level / by-tenure / by-department distributions + driver candidates; LLM ranks 3-5 root-cause factors with citations. Persists as a child PayEquityRun with `agentType=cohort_root_cause`. |
| 1.6 | Statistical tests panel (β, SE, p, CI, n)          | ✅     | Inside the cohort drill-down card header                                                                                                                                                                                                                                                           |
| 1.7 | Outlier list                                       | ✅     | `GET /pay-equity/runs/:id/outliers`; lowest compa-ratio employees within significant cohorts. AI explainer shipped in 1.5                                                                                                                                                                          |
| 1.5 | Outlier AI explainer                               | ✅     | Shipped 2026-04-28. `POST /pay-equity/runs/:id/outliers/:employeeId/explain`. Per-employee paragraph + recommended action + severity. Persists as a child PayEquityRun with `agentType=outlier_explainer`.                                                                                         |

### Phase 2 — Remediate _(shipped 2026-04-28)_

| #   | Feature                                                   | Status | Notes                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | Target-gap + max-per-employee slider                      | ✅     | `targetGapPercent` + `maxPerEmployeePct` are inputs to `POST /pay-equity/runs/:id/remediations/calculate`; UI exposes both as sliders                                                                                                                               |
| 2.2 | Suggested adjustments table                               | ✅     | Per-employee fromValue / toValue / deltaValue / deltaPercent rendered in `RemediationsTable`. Sorted by lowest CR first                                                                                                                                             |
| 2.3 | Remediation AI (deterministic adjustments + AI narrative) | ✅     | `pay-equity-remediation-graph.ts` returns ordered justifications + planSummary + alternativeScenarios under `PayEquityAgentResult` contract. Adjustments themselves are deterministic (raise underpaid toward cohort mean, capped). Greedy MVP — LP solver deferred |
| 2.4 | Phased multi-quarter plan generator                       | ⬜     | Deferred. Will split applied set into Q-buckets in a later session                                                                                                                                                                                                  |
| 2.5 | Apply (direct salary writeback)                           | ✅     | `POST /pay-equity/runs/:id/remediations/apply` writes `Employee.baseSalary`, flips status to APPLIED, emits an AuditLog row per change. Direct writeback chosen over CompCycle creation — see decision log                                                          |
| 2.6 | Remediation letters (Letters module)                      | ⬜     | Deferred. Hook into existing Letters batch infra in a later session                                                                                                                                                                                                 |

### Phase 3 — Report _(first cut shipped 2026-04-28)_

| #   | Feature                                 | Status | Notes                                                                                                                                                                                                                                           |
| --- | --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | Board narrative PDF (styled export)     | ✅     | `GET /pay-equity/runs/:id/reports/board`. Renders the run envelope as styled HTML (executive summary, headline cards, cohort table, methodology box) → Puppeteer → PDF                                                                          |
| 3.2 | **EU PTD report**                       | ✅     | `GET /pay-equity/runs/:id/reports/eu_ptd`. CSV with Article 9 metadata header + cohort rows. Bonus + median + quartile fields explicitly marked `not_available` until canonical schema gains the underlying data. **Needs comp-lawyer review.** |
| 3.3 | UK Gender Pay Gap report                | ✅     | `GET /pay-equity/runs/:id/reports/uk_gpg`. CSV with the six required figures. Mean gap derived from regression coefficient on gender; median/bonus/quartiles `not_available` until raw payroll wired                                            |
| 3.4 | EEO-1 export                            | ✅     | `GET /pay-equity/runs/:id/reports/eeo1`. CSV with sex column populated from gender cohorts; race/ethnicity + EEO job category `not_available` until canonical mapping wired                                                                     |
| 3.5 | California SB 1162 disclosure           | ✅     | `GET /pay-equity/runs/:id/reports/sb1162`. CSV with establishment header + cohort rows. Mean/median hourly rate `not_available` until raw payroll wired                                                                                         |
| 3.6 | Comp committee deck generator           | ⬜     | Deferred. Slide auto-generation needs additional renderer infra                                                                                                                                                                                 |
| 3.7 | Scheduled delivery (annual/quarterly)   | ⬜     | Deferred. Needs cron + email infra hookup                                                                                                                                                                                                       |
| 3.8 | Watermarked + anonymized auditor export | ✅     | `GET /pay-equity/runs/:id/reports/auditor`. PDF with hashed (sha256, tenant-scoped, 12 hex) tenant id, full methodology + regression detail + citation list. Watermark "AUDITOR EXPORT" rendered at 30°                                         |

### Phase 4 — Predict & Prevent _(~1 week, 2 sessions)_

| #   | Feature                                   | Status | Effort | Notes                           |
| --- | ----------------------------------------- | ------ | ------ | ------------------------------- |
| 4.1 | Forward-looking gap projection (12-month) | ⬜     | 1 d    | New graph                       |
| 4.2 | Hiring impact modeler                     | ⬜     | 1 d    | "If we hire 50 ICs..."          |
| 4.3 | Promotion slate equity check              | ⬜     | 1 d    | Auto-runs on cycle's promo list |
| 4.4 | Pay band drift detector                   | ⬜     | 1 d    |                                 |
| 4.5 | AIR (80% rule) tracking                   | ⬜     | 0.5 d  |                                 |
| 4.6 | In-cycle warning at manager workspace     | ⬜     | 1.5 d  | Hooks /comp-cycles/my-team      |
| 4.7 | Real-time pre-offer guardrail             | ⬜     | 1 d    |                                 |

### Phase 5 — Trust _(~3-4 days, 1 session)_

| #   | Feature                                   | Status | Effort | Notes             |
| --- | ----------------------------------------- | ------ | ------ | ----------------- |
| 5.1 | Methodology documentation auto-generation | ⬜     | 1 d    | Per-run           |
| 5.2 | Audit log of every analysis               | ⬜     | 0.5 d  |                   |
| 5.3 | Restricted access + role-gating           | ⬜     | 0.5 d  |                   |
| 5.4 | Defensibility documentation export        | ⬜     | 1 d    | "If litigated..." |
| 5.5 | External auditor read-only portal         | ⬜     | 1 d    | Hashed IDs        |

### Phase 6 — Self-service & Polish _(~3-4 days, optional)_

| #   | Feature                            | Status | Effort | Notes           |
| --- | ---------------------------------- | ------ | ------ | --------------- |
| 6.1 | Employee personal equity statement | ⬜     | 1 d    |                 |
| 6.2 | Pay range publication module       | ⬜     | 1 d    | CA/NY/CO/EU     |
| 6.3 | Manager equity copilot (Q&A)       | ⬜     | 1.5 d  | Bounded RAG     |
| 6.4 | CHRO daily digest (Slack + email)  | ⬜     | 1 d    | Recurring touch |

**Total: ~5 weeks of disciplined work.**

---

## 5 — Feature catalog (rolling status table)

Will populate as we ship. Format:

| Phase    | Feature                                                                                                                                                                 | Status | Commit | Demo notes                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| existing | Pay Equity narrative graph (LLM)                                                                                                                                        | ✅     | —      | Pre-existing; produces EDGE-style report                                                                                             |
| existing | Analyzer page (one-shot)                                                                                                                                                | ✅     | —      | Untouched. Lives at `/dashboard/analytics/pay-equity`.                                                                               |
| existing | EDGE flow + `PayEquityReport` schema                                                                                                                                    | ✅     | —      | Untouched. Lives at `/dashboard/analytics/pay-equity/edge`.                                                                          |
| existing | Real OLS regression engine in legacy `PayEquityService`                                                                                                                 | ✅     | —      | Reused by the new module via injection.                                                                                              |
| 0        | `PayEquityAgentResult<T>` AI agent contract                                                                                                                             | ✅     | TBD    | packages/ai/src/types/pay-equity.ts; exported from index                                                                             |
| 0        | `PayEquityRun` + `PayEquityRemediation` Prisma models + migration SQL                                                                                                   | ✅     | TBD    | Migration not yet applied — run `pnpm db:migrate`                                                                                    |
| 0        | New `pay-equity` API module: POST runs, GET runs, GET runs/:id, GET overview                                                                                            | ✅     | TBD    | Routes are `/api/v1/pay-equity/*`                                                                                                    |
| 0        | Audit log writes (`action=PAY_EQUITY_RUN`) on every analysis                                                                                                            | ✅     | TBD    |                                                                                                                                      |
| 0        | Methodology versioning (`edge-multivariate@2026.04`) stamped on every run                                                                                               | ✅     | TBD    | Constants live in PayEquityV2Service                                                                                                 |
| 0        | Eval harness: 5 golden examples + 28 structural assertions                                                                                                              | ✅     | TBD    | Phase 1 adds LLM-as-judge scoring                                                                                                    |
| 0        | k-anonymity guard (n<5) + sample-size warning (n<30) helpers in agent contract                                                                                          | ✅     | TBD    | `checkKAnonymity`, `checkSampleSize` in packages/ai                                                                                  |
| 0        | Workspace shell page at `/dashboard/pay-equity` with 5 tabs + status bar                                                                                                | ✅     | TBD    | Overview tab wired; Diagnose/Remediate/Reports/Prevent placeholders                                                                  |
| 0        | useMyPayEquity React Query hooks (overview, runs list, run detail, run mutation)                                                                                        | ✅     | TBD    | apps/web/src/hooks/use-pay-equity.ts                                                                                                 |
| 0        | Sidebar entry: "Pay Equity Workspace" under AI Features                                                                                                                 | ✅     | TBD    | navigation.ts                                                                                                                        |
| 0        | 7 service unit tests + 28 eval-harness assertions                                                                                                                       | ✅     | TBD    | All green                                                                                                                            |
| 1        | `GET /pay-equity/trend?dimension&limit` — last-N runs time series                                                                                                       | ✅     | TBD    | Includes `methodologyShifts[]` so UI can flag drift between runs                                                                     |
| 1        | `GET /pay-equity/runs/:id/cohorts` — heatmap-friendly cell array                                                                                                        | ✅     | TBD    | Severity score + `suppressed` flag per cell                                                                                          |
| 1        | `GET /pay-equity/runs/:id/cohorts/:dim/:group` — drill-down with k-anon gate                                                                                            | ✅     | TBD    | Returns `suppressed: true` with reason when n<5                                                                                      |
| 1        | `GET /pay-equity/runs/:id/outliers` — lowest compa-ratio in significant cohorts                                                                                         | ✅     | TBD    | Statistical only; AI explainer in Phase 1.5                                                                                          |
| 1        | Diagnose tab UI: trend bar-chart + cohort heatmap + drill-down panel + outliers                                                                                         | ✅     | TBD    | All four panels live; replaces phase placeholder                                                                                     |
| 1        | Phase 1 hook additions (useTrend, useCohorts, useCohortDetail, useOutliers)                                                                                             | ✅     | TBD    | apps/web/src/hooks/use-pay-equity.ts                                                                                                 |
| 1        | 9 new service tests (trend ordering + methodology shift, cohort suppression, drill-down k-anon, outliers empty + populated)                                             | ✅     | TBD    | 44 total tests green                                                                                                                 |
| 1.5      | `pay-equity-cohort-graph.ts` — cohort root-cause LLM agent                                                                                                              | ✅     | TBD    | Single LLM call; service pre-computes distributions; structured JSON output                                                          |
| 1.5      | `pay-equity-outlier-graph.ts` — outlier explainer LLM agent                                                                                                             | ✅     | TBD    | Per-employee paragraph + action + severity; sanity-check vs CR rule of thumb                                                         |
| 1.5      | `POST /pay-equity/runs/:id/cohorts/:dim/:group/root-cause`                                                                                                              | ✅     | TBD    | Persists child PayEquityRun + AuditLog (action=PAY_EQUITY_COHORT_ROOT_CAUSE)                                                         |
| 1.5      | `POST /pay-equity/runs/:id/outliers/:employeeId/explain`                                                                                                                | ✅     | TBD    | Persists child PayEquityRun + AuditLog (action=PAY_EQUITY_OUTLIER_EXPLAIN)                                                           |
| 1.5      | k-anonymity gate at the agent boundary (refuses cohort with n<5 before invoking LLM)                                                                                    | ✅     | TBD    | Prevents PII leakage through the LLM channel                                                                                         |
| 1.5      | Web hooks (`useAnalyzeCohortRootCauseMutation`, `useExplainOutlierMutation`) + UI buttons in Diagnose tab                                                               | ✅     | TBD    | "Analyze root cause" on cohort drill-down; per-row "Explain" on outlier list                                                         |
| 1.5      | 7 new service tests (cohort root-cause persistence + k-anon refusal + agent-failure path; outlier explainer persistence + cohort-match refusal + missing-CR refusal)    | ✅     | TBD    | 51 total tests green; LLM stubbed via vi.mock                                                                                        |
| 2        | `pay-equity-remediation-graph.ts` — narrative-only LLM agent (numbers come from service)                                                                                | ✅     | TBD    | Returns ordered justifications, planSummary, alternativeScenarios with citations + methodology + warnings under PayEquityAgentResult |
| 2        | Deterministic adjustment computer — raise underpaid toward cohort mean, capped at `maxPerEmployeePct`, sorted by lowest CR                                              | ✅     | TBD    | Greedy MVP. LP solver / multi-objective optimization deferred                                                                        |
| 2        | `POST /pay-equity/runs/:id/remediations/calculate` — proposes adjustments + persists child run + bulk PayEquityRemediation rows (PROPOSED)                              | ✅     | TBD    | Audit action `PAY_EQUITY_REMEDIATION_PROPOSED`. 5/min throttle. k-anon enforced via parent-run cohort gate                           |
| 2        | `GET /pay-equity/runs/:id/remediations` — hydrated rows with employee context                                                                                           | ✅     | TBD    | Includes counts (proposed/approved/declined/applied) + totalProposedCost                                                             |
| 2        | `PATCH /pay-equity/remediations/:id/decision` — APPROVE / DECLINE a single PROPOSED row                                                                                 | ✅     | TBD    | Audit action `PAY_EQUITY_REMEDIATION_DECISION`. Refuses non-PROPOSED                                                                 |
| 2        | `POST /pay-equity/runs/:id/remediations/apply` — writes `Employee.baseSalary` for every APPROVED row, flips to APPLIED                                                  | ✅     | TBD    | One AuditLog row per employee change (`PAY_EQUITY_REMEDIATION_APPLIED`). Refuses non-remediation runs                                |
| 2        | RemediatePanel + RemediationsTable web UI                                                                                                                               | ✅     | TBD    | Slider inputs, compute button, status counts, per-row ✓/✗ buttons, apply confirm dialog. Replaces Phase 2 placeholder                |
| 2        | Phase 2 hook additions (useCalculateRemediationsMutation, useRemediations, useDecideRemediationMutation, useApplyRemediationsMutation)                                  | ✅     | TBD    | apps/web/src/hooks/use-pay-equity.ts                                                                                                 |
| 2        | 11 new service tests (calculate proposes/caps/refuses/FAIL; decide approves+audit / refuses non-PROPOSED; apply writes baseSalary+audit / zero counts / non-rem refuse) | ✅     | TBD    | 60 total tests green (32 service + 28 eval); LLM stubbed via vi.mock                                                                 |
| 3        | `report-renderers.ts` — pure renderer module (CSV string or PDF-ready HTML) for 6 report types                                                                          | ✅     | TBD    | Deterministic; no LLM. Statutory CSVs explicitly mark fields as `not_available` rather than blank when source data isn't yet wired   |
| 3        | Board narrative PDF, EU PTD CSV, UK GPG CSV, EEO-1 CSV, CA SB 1162 CSV, auditor PDF                                                                                     | ✅     | TBD    | Auditor export hashes tenant id (sha256, 12 hex) and renders an "AUDITOR EXPORT" watermark; raw tenant id never appears in the PDF   |
| 3        | `GET /pay-equity/runs/:id/reports/:type` — single download endpoint (PDF or CSV) with audit log                                                                         | ✅     | TBD    | 30/min throttle; refuses non-narrative / FAILED runs / unknown type. Returns BOM-prefixed UTF-8 for CSV so Excel opens cleanly       |
| 3        | Puppeteer renderer in PayEquityV2Service (chrome path resolved at module init, falls back to BadRequestException if no Chrome on host)                                  | ✅     | TBD    | Same chrome-detection pattern as Letters. PDF generation throws clearly when host has no Chrome instead of degrading silently        |
| 3        | ReportsPanel UI in `/dashboard/pay-equity` — 6 download cards with format badges                                                                                        | ✅     | TBD    | Replaces the Phase 3 placeholder. Disabled state when no run exists. Per-card spinner during download                                |
| 3        | 11 new tests (6 renderer-level + 5 service-level: CSV BOM/audit, PDF without chrome refusal, unknown/FAILED/non-narrative refusals)                                     | ✅     | TBD    | 71 total tests green (43 service + 28 eval). Renderer tests assert content shape; service tests cover the audit + rejection paths    |

(Add rows as features ship.)

---

## 6 — Decision log

| Date       | Decision                                                                                                                        | Rationale                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-28 | Build Pay Equity end-to-end as the wedge feature                                                                                | CHRO buyer, regulatory tailwind, existing AI strength                                                                                                                                                                                                                                                                                                                                                    |
| 2026-04-28 | Maintain `PAY_EQUITY_CONTEXT.md` as the source of truth                                                                         | Multi-week arc needs persistence across sessions                                                                                                                                                                                                                                                                                                                                                         |
| 2026-04-28 | Phase 0 (foundation) before any feature work                                                                                    | Avoid the "shallow everything" trap from today's comp-cycle session                                                                                                                                                                                                                                                                                                                                      |
| 2026-04-28 | AI agent contract enforces citations + methodology + runId                                                                      | Defensibility = trust = sellability to CHRO                                                                                                                                                                                                                                                                                                                                                              |
| 2026-04-28 | k-anonymity threshold n<5 (cohort), n<30 (specific salary disclosures)                                                          | Privacy + statutory compliance                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-04-28 | New module `pay-equity` _coexists_ with legacy `analytics/pay-equity` and `analytics/pay-equity/edge` instead of replacing them | "Stop breaking things" rule. Legacy works; we migrate users in later phases when the new shell has parity + extras.                                                                                                                                                                                                                                                                                      |
| 2026-04-28 | Methodology pinned to `edge-multivariate@2026.04` as the Phase 0 default                                                        | Captures EDGE Standard methodology assumptions. Bump version when controls/threshold change.                                                                                                                                                                                                                                                                                                             |
| 2026-04-28 | Migration file written to disk but NOT auto-applied; user runs `pnpm db:migrate` manually                                       | Avoid silent prod schema changes.                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-04-28 | LLM narrative invocation deferred to Phase 1.5                                                                                  | Phase 0 priority is contract + persistence + audit trail; LLM call adds latency and isn't required for the foundation demo.                                                                                                                                                                                                                                                                              |
| 2026-04-28 | Phase 1.5 (cohort root-cause AI + outlier AI explainer) deferred to its own session                                             | Builds on Phase 1 data shape; needs LLM-as-judge eval upgrade first to gate model drift. Phase 1 ships statistical + UI now.                                                                                                                                                                                                                                                                             |
| 2026-04-28 | Outlier detection uses compa-ratio as proxy (lowest CR within significant cohorts) instead of full residual analysis            | Compa-ratio is reliable + already in schema; full residual modeling pairs naturally with the AI explainer in 1.5.                                                                                                                                                                                                                                                                                        |
| 2026-04-28 | Trend chart rendered as bars instead of pulling in an external chart library                                                    | Avoids new dep + version surface; bars communicate gap magnitude well enough for Phase 1. SVG line chart deferred.                                                                                                                                                                                                                                                                                       |
| 2026-04-28 | Phase 1.5 AI agents pre-compute deterministic context (distributions, peer means, sibling cohorts) BEFORE invoking the LLM      | Hard rule against LLM hallucination on numeric claims. Agent prompt says "every number must appear in input or do not say it."                                                                                                                                                                                                                                                                           |
| 2026-04-28 | Phase 1.5 k-anonymity check moved to the AGENT boundary (service refuses to invoke LLM when cohort n<5)                         | Prevents the LLM channel from becoming a sidecar PII exfiltration path. A small cohort never gets near the model.                                                                                                                                                                                                                                                                                        |
| 2026-04-28 | Each Phase 1.5 agent invocation persists a separate PayEquityRun row instead of mutating the parent                             | Audit trail per AI run; trend can show "this cohort analyzed 3 times in last week"; eval harness has stable targets.                                                                                                                                                                                                                                                                                     |
| 2026-04-28 | LLM-as-judge eval scoring deferred (still structural-only harness from Phase 0)                                                 | Needs a real OpenAI key in CI to score 5 goldens × 4 axes. Coordinate with infra before enabling. Schema drift is gated already.                                                                                                                                                                                                                                                                         |
| 2026-04-28 | Phase 2 adjustments are deterministic; LLM only narrates (justifications + planSummary + alternativeScenarios)                  | Same anti-hallucination rule as Phase 1.5 — every dollar/percent in the narrative must come from the input the service computed.                                                                                                                                                                                                                                                                         |
| 2026-04-28 | Phase 2 MVP uses greedy adjustments (raise underpaid toward cohort mean, capped at maxPerEmployeePct), not an LP solver         | Linear programming buys very little before we have real customer constraints (budget caps, band guards). Greedy is auditable + cheap; LP can replace it once a customer tells us what their real objective is.                                                                                                                                                                                           |
| 2026-04-28 | "Apply" writes directly to `Employee.baseSalary` instead of synthesizing a CompCycle                                            | Pay equity remediations are ad-hoc corrections, not cycle decisions. Forcing them through CompCycle would (a) co-mingle merit/promo budgets, (b) require a fake cycle wrapper for every apply. We still emit a per-row AuditLog and persist PayEquityRemediation status APPLIED — same audit story, less plumbing.                                                                                       |
| 2026-04-28 | k-anonymity gate is inherited from the parent run's cohort scope at the remediation step                                        | The parent run already filtered out n<5 cohorts before persisting significant cohorts. Phase 2 only proposes adjustments inside those significant cohorts, so the gate is enforced upstream. No second LLM-touch of small-cohort PII.                                                                                                                                                                    |
| 2026-04-28 | Phase 3 statutory CSVs ship with explicit `not_available` markers for fields that need source data we don't yet have            | EU PTD bonus + median + quartile, UK GPG median + bonus + quartiles, EEO-1 race + job category, SB 1162 hourly rate. A blank cell looks like a bug; `not_available` reads as a feature gap. Customers can't file these as-is — bible §8 risk row says comp-lawyer review is required before filing — but the export pipeline + CSV shape + audit trail are real, and additive data wiring is mechanical. |
| 2026-04-28 | Auditor export uses tenant-scoped sha256 (12 hex) for identifiers; raw tenant id never appears in the PDF                       | An auditor's job is defensibility, not data exfiltration. Hashes preserve cell-level reproducibility (same id → same hash for the same tenant) without exposing PII. Cross-tenant correlation is blocked because the hash includes the tenant id as salt.                                                                                                                                                |
| 2026-04-28 | Phase 3 reports are read-only artifacts; no separate ReportRun row is persisted, only an AuditLog row per export                | The PayEquityRun envelope is already immutable, so an export is reproducible from runId alone. A child run for every download would dilute the trend chart with non-statistical noise. AuditLog (`action=PAY_EQUITY_REPORT_EXPORTED`) preserves the who/when/which.                                                                                                                                      |
| 2026-04-28 | PDF rendering reuses the Letters service's Puppeteer pattern (chrome detection at module init, no per-request probing)          | Same code path is battle-tested; duplicating ~30 lines beats coupling Pay Equity to the Letters module. Hosts without Chrome fail closed (BadRequestException) rather than silently falling back to a worse renderer — auditor exports must be pixel-stable.                                                                                                                                             |

---

## 7 — Open questions

Need answers before the relevant phase ships:

| #   | Question                                                                                       | Blocks phase | Owner   | Status |
| --- | ---------------------------------------------------------------------------------------------- | ------------ | ------- | ------ |
| Q1  | Do we have a comp consultant for methodology validation? Need ~$3-5K, 1 wk engagement.         | Phase 3      | Santosh | open   |
| Q2  | Will customers have race/ethnicity data in their HRIS, or is gender-only the realistic target? | Phase 1      | Santosh | open   |
| Q3  | Is there a customer pipeline deadline that should reorder phases (e.g. EU PTD demo by Q3)?     | Sequencing   | Santosh | open   |
| Q4  | Do we need a privacy/legal review for the auditor portal export shape?                         | Phase 5      | Santosh | open   |
| Q5  | EDGE Certified — do we want to certify, or just claim methodology adherence?                   | Phase 3      | Santosh | open   |
| Q6  | Should `log(salary)` regression be supplemented with quantile regression or Oaxaca-Blinder?    | Phase 1      | TBD     | open   |

---

## 8 — Risks & mitigations

| Risk                                                  | Impact                                       | Likelihood             | Mitigation                                                       |
| ----------------------------------------------------- | -------------------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| Statutory format wrong (EU PTD, UK GPG, EEO-1)        | Customer can't file → churn                  | Medium                 | Legal review pass before Phase 3 ships; partner with comp lawyer |
| Methodology not defensible under audit                | Customer's auditor rejects → reputation risk | Medium                 | Versioning + comp consultant validation in Phase 5               |
| Customer HRIS lacks protected-class data              | Feature can't run for some customers         | High                   | Graceful degradation + onboarding flow that asks                 |
| Privacy bug exposes small-cohort data                 | Regulatory risk + customer trust loss        | Low if k-anon enforced | k-anon middleware, automated tests, redaction in prompts         |
| LLM drift (model upgrade changes report tone/content) | Inconsistent reports → customer complaint    | Medium                 | Eval harness gates model upgrades                                |
| Optimization solver produces unrealistic remediations | Customer ignores recommendations             | Medium                 | Manual override always available; show top-3 alternatives        |

---

## 9 — Eval examples (golden set)

Will populate in Phase 0. Target: 5 examples for Phase 0, expand to 20 by end of Phase 1.

Each example is `{input, expectedOutputShape, scoringRubric}`:

- `input`: synthetic employee dataset + cycle data + protected class breakdown
- `expectedOutputShape`: required sections of the narrative, citation count floor, methodology version
- `scoringRubric`: how LLM-as-judge scores each axis

(Examples to be authored in Phase 0.)

---

## 10 — Reference materials

To be linked / quoted in implementation:

- **EDGE Certified methodology** — official spec at edge-cert.org (TODO: verify exact URL)
- **EU Pay Transparency Directive** — Directive (EU) 2023/970 (full text needed for Phase 3)
- **UK Gender Pay Gap reporting** — gov.uk/guidance/gender-pay-gap-reporting (statutory categories, thresholds)
- **EEO-1 Component 1** — eeoc.gov instructions (race/ethnicity + gender categories + EEO job categories)
- **California SB 1162** — labor.ca.gov pay-data + pay-range disclosure
- **NYC Local Law 32** — pay transparency
- **Colorado Equal Pay for Equal Work Act** — coag.gov guidance
- **OFCCP AIR (80% rule)** — adverse impact ratio guidance
- **Oaxaca-Blinder decomposition** — for gap-driver attribution (Phase 1.5)

---

## 11 — Changelog

| Date       | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | By                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 2026-04-28 | Initial bible created with 6-phase plan, agent contract, methodology, risks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Claude (session 2026-04-27/28) |
| 2026-04-28 | Phase 0 (Foundation) shipped: agent contract types, Prisma models + migration SQL, new pay-equity module with audit + methodology versioning, eval harness with 5 goldens + 28 structural assertions, workspace shell at /dashboard/pay-equity with 5 tabs (Overview wired). 7 service tests + 35 total tests green. Legacy analyzer + EDGE flow untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Claude                         |
| 2026-04-28 | Phase 1 (Diagnose) shipped: trend endpoint + bar-chart UI with methodology-shift markers; cohort matrix endpoint + severity-tinted clickable heatmap with k-anonymity gate; cohort drill-down endpoint + employee-row table with full statistical-test panel; outlier endpoint (statistical, AI explainer deferred to 1.5) + ranked list. 9 new service tests, 44 total green.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Claude                         |
| 2026-04-28 | Phase 1.5 (AI agents) shipped: cohort root-cause LLM agent + outlier explainer LLM agent, both wrapped in PayEquityAgentResult contract with citations + methodology + warnings + confidence. Service pre-computes deterministic context (distributions, peer means, sibling cohorts) so the LLM never has to query the DB. Each invocation persists a child PayEquityRun row (agentType `cohort_root_cause` / `outlier_explainer`) and writes an AuditLog row. UI: "Analyze root cause" button on cohort drill-down + per-row "Explain" buttons on outlier list, both rendering structured AI output with severity badge + citation count + run id. 7 new service tests with vi.mock'd LLM, 51 total green.                                                                                                                                                                                                                                                                                                                                                                                                    | Claude                         |
| 2026-04-28 | Phase 2 (Remediate) shipped: deterministic adjustment computer (raise underpaid toward cohort mean, capped at maxPerEmployeePct, sorted by lowest CR) + narrative-only LLM agent (`pay-equity-remediation-graph.ts`) that returns ordered justifications + planSummary + alternativeScenarios under the PayEquityAgentResult contract. Four endpoints: calculate (proposes + persists child run + bulk PROPOSED rows), list, decide (APPROVE/DECLINE single row + audit), apply (writes Employee.baseSalary + per-row audit + flips to APPLIED). RemediatePanel + RemediationsTable UI replaces the Phase 2 placeholder. 11 new service tests, 60 total green (32 service + 28 eval). Phase 2.4 multi-quarter plan + 2.6 letters hook deferred.                                                                                                                                                                                                                                                                                                                                                                 | Claude                         |
| 2026-04-28 | Phase 3 (Report) first cut shipped: pure renderer module producing 6 artifacts — board narrative PDF, EU PTD CSV, UK GPG CSV, EEO-1 CSV, CA SB 1162 CSV, auditor PDF. Single `GET /pay-equity/runs/:id/reports/:type` endpoint, 30/min throttle, BOM-prefixed UTF-8 CSV for Excel compatibility, BadRequestException when host has no Chrome instead of silent degradation. Statutory fields that need source data we don't yet have (bonus, hourly rate, quartiles, race/ethnicity, job category) are explicitly emitted as `not_available` rather than blank. Auditor PDF hashes the tenant id (sha256, 12 hex) and watermarks "AUDITOR EXPORT". Each export writes an AuditLog row (`action=PAY_EQUITY_REPORT_EXPORTED`); no child PayEquityRun is created since the envelope is already immutable. ReportsPanel UI with 6 download cards replaces the Phase 3 placeholder. 11 new tests (6 renderer-level + 5 service-level), 71 total green. Phase 3.6 (comp committee deck) + 3.7 (scheduled delivery) deferred to a later session; statutory CSVs need a comp-lawyer review pass before customer filing. | Claude                         |

---

## How to use this doc

**Each session:**

1. Read sections 0 (Quick Start) + 4 (Phase plan) + 5 (Feature catalog) + 6 (Decisions) + 7 (Open Qs)
2. Pick the next ⬜ item from the current phase
3. Build it
4. Update sections 5 + 6 + 11 with the work done
5. If a question got answered, update section 7
6. If a risk materialized, update section 8

**When phase completes:**

- Move all phase items to ✅ in section 4 + 5
- Add a phase-summary entry in changelog
- Demo to user; capture feedback as new decisions in section 6

**When stuck:**

- Re-read section 1 (Vision) and section 2 (Architecture) — most stuck moments are scope-drift
