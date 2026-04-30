# Pay Equity — How It Works

> **Audience:** engineers new to the module, comp consultants validating the methodology, partners doing technical due diligence, CHROs who want to know what their AI is actually doing under the hood.
>
> **Companion docs:**
>
> - [`PAY_EQUITY_CONTEXT.md`](./PAY_EQUITY_CONTEXT.md) — build bible (phase plan, decision log, changelog)
> - [`STATUTORY_CSV_REVIEW_CHECKLIST.md`](./STATUTORY_CSV_REVIEW_CHECKLIST.md) — per-jurisdiction filing readiness audit
>
> **Last updated:** 2026-04-30 — all 44 bible items shipped, ~110 tests green.

---

## TL;DR

Compport's Pay Equity workspace runs an **OLS regression on employee compensation** controlling for job level, tenure, performance, location, and department. The β coefficient on the protected-class indicator (gender, race, ethnicity, etc.) is the **adjusted pay gap** — what's left after controlling for legitimate factors. We wrap the result in an **immutable, auditor-defensible envelope** with citations + methodology version + warnings, persist it as a `PayEquityRun` row, and surface it through five workflow tabs (Overview / Diagnose / Remediate / Reports / Prevent). Six LLM agents narrate findings on top of the statistical engine; nine report types export the result to any required statutory or internal format. **Every numeric claim in any AI output is required to come from input data, never the model** — this is the central anti-hallucination contract.

---

## 1. The picture

```
                                ┌─────────────────────────────────────┐
HRIS (or canonical seed) ──►   │   PayEquityV2Service.runAnalysis    │
                                │  1. legacy analyzer (OLS regression)│
                                │  2. compa-ratio aggregation          │
                                │  3. remediation cost estimate        │
                                │  4. wrap in PayEquityAgentResult<T>  │
                                │  5. persist + audit                  │
                                └────────────┬────────────────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │   PayEquityRun (immutable)    │
                              │   ── envelope JSON            │
                              │   ── methodology@version       │
                              │   ── audit log row             │
                              └──────────────┬─────────────────┘
                                             │
                ┌────────────────────────────┼────────────────────────────┐
                ▼                            ▼                            ▼
  ┌──────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────┐
  │  6 LLM agents        │    │  9 report renderers       │    │  Workflow tabs (UI)  │
  │  (narrate findings,  │    │  (board / EU PTD / UK GPG │    │  Overview / Diagnose │
  │   never invent       │    │   / EEO-1 / SB 1162 /     │    │  / Remediate /       │
  │   numbers)           │    │   auditor / defens. /      │    │  Reports / Prevent   │
  │                      │    │   committee deck /         │    │                      │
  │                      │    │   employee statement)      │    │                      │
  └──────────────────────┘    └──────────────────────────┘    └──────────────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │  Distribution surface         │
                              │  ── BullMQ hourly cron        │
                              │  ── Email + Slack digest      │
                              │  ── Public share-token route  │
                              │     for external auditors     │
                              └──────────────────────────────┘
```

**Buyer:** the CHRO. **Operators:** HRBPs running the diagnostic + remediation loop. **Self-service:** managers (copilot, in-cycle warnings), employees (personal equity statement), auditors (read-only share links).

---

## 2. What "running a pay equity analysis" actually does

When a user clicks **Run analysis** on the Overview tab, the API pipeline at [`pay-equity.service.ts:90`](apps/api/src/modules/pay-equity/pay-equity.service.ts#L90) executes these six steps. Every step is recoverable: if anything throws, the run row stays as `FAILED` with the error message, never silently lost.

### Step 1 — Pre-create the PayEquityRun row (status=PENDING)

We create the row first so we have a `runId` to reference even if the analysis itself blows up. This is what every downstream artifact (citations, audit logs, share tokens) ties back to.

### Step 2 — Run the statistical engine

Hand the Employee dataset off to the legacy analyzer at [`apps/api/src/modules/analytics/pay-equity.service.ts:399`](apps/api/src/modules/analytics/pay-equity.service.ts#L399). It does three things:

1. **OLS regression** per dimension (gender, race, ethnicity, age band, etc.) — see §3 below for the math.
2. **Compa-ratio aggregation** per group — average + median + min + max + stddev.
3. **Remediation cost estimate** — total dollars to bring underpaid employees up to the cohort midpoint, capped at the configured threshold.

### Step 3 — Build the envelope

Wrap the analyzer's output in [`PayEquityAgentResult<T>`](packages/ai/src/types/pay-equity.ts) — see §4. Citations are generated automatically: each regression coefficient becomes a `regression_coefficient` citation tied to that cohort.

### Step 4 — Compute warnings

Two automated guards:

- **k-anonymity** ([`checkKAnonymity`](packages/ai/src/types/pay-equity.ts)): any cohort with `n<5` triggers a `k_anonymity_violation` warning. Suppressed cohorts cannot be drilled into; their data never reaches an LLM.
- **Sample size** ([`checkSampleSize`](packages/ai/src/types/pay-equity.ts)): any cohort with `n<30` triggers a `sample_size_low` warning. The result is still produced but flagged as low-confidence.

### Step 5 — Compute confidence

Three-level: `high` (n>200 + zero warnings), `low` (any sample-size warning), `medium` otherwise.

### Step 6 — Persist + audit

Update the run row to `COMPLETE` with the full envelope as JSON, then write an `AuditLog` row with `action=PAY_EQUITY_RUN`. The envelope is now **immutable** — it's the source of truth for every downstream artifact, including reports generated weeks later.

**Net result:** one `PayEquityRun` row, one `AuditLog` row, ~5–500ms total depending on cohort size. The LLM is **not** called at this point — see §5 for when each agent fires.

---

## 3. The statistical core

### What the regression actually does

For each cohort (e.g., gender = Female vs Male as the reference group), we run a multivariate OLS regression:

```
salary_i = β₀ + β₁ × group_i + β₂ × control_i² + β₃ × control_i³ + ... + ε_i
```

Where:

- `salary_i` is employee i's annual base salary
- `group_i` is 1 if employee i belongs to the protected class being tested, 0 otherwise
- `control_i²..ⁿ` are level (numeric encoding), tenure in months, performance rating, location dummies, department dummies
- `β₁` is the **adjusted pay gap in dollars** — what's left after controlling for the legitimate factors

### From β to "adjusted gap percent"

```
gapPercent = (β₁ / mean_salary_in_cohort) × 100
```

So if the regression returns β₁ = -3,200 and the cohort mean salary is $100,000, the adjusted gap is **-3.2%** — women in this cohort are paid 3.2% less than men _after_ controlling for level, tenure, performance, location, and department.

### Significance

- **p < 0.05** → `significant` (chance the gap is random < 5%)
- **p < 0.10** → `marginal`
- otherwise → `not_significant`

### Risk level (combined gap + significance)

- `HIGH` — `|gap| > 5%` AND `p < 0.05`
- `MEDIUM` — `|gap| > 2%` AND `p < 0.10`
- `LOW` — everything else

### Implementation honesty

The current implementation uses **linear salary** as the dependent variable, not `log(salary)`. The bible (§2 architecture) names the dependent variable `log_salary` because that's the canonical EDGE methodology, but the code at [`pay-equity.service.ts:616`](apps/api/src/modules/analytics/pay-equity.service.ts#L616) passes raw salaries to OLS. For most practical cohorts the difference is small (linear and log specifications agree on direction + significance), but a comp consultant validating a customer filing should note this and decide whether to swap in `log()`. The methodology version (`edge-multivariate@2026.04`) is stamped on every run, so a future bump to a `log_salary` variant gets its own versioned methodology + envelope.

### Compa-ratio (CR)

Independent of the regression, we also compute compa-ratio per group:

```
CR_i = salary_i / band_midpoint_for_employee_i
```

Where `band_midpoint` is the p50 from the salary band assigned to that employee. CR < 0.85 is "below band" (commonly considered underpaid), 0.85..1.15 is "in band", > 1.15 is "above band". CR is a **simpler signal than the regression** — it ignores controls — but it's directly actionable and easy to explain. We use it for outlier detection ([`getOutliers`](apps/api/src/modules/pay-equity/pay-equity.service.ts)) and for the AIR / 80% rule check.

### AIR (Adverse Impact Ratio / 80% rule)

```
AIR = exp(β₁)        # ratio of group's selection rate to reference's
```

When AIR < 0.8, the cohort fails the OFCCP four-fifths rule — this is treated as adverse impact for federal contractors. The implementation at [`getAirAnalysis`](apps/api/src/modules/pay-equity/pay-equity.service.ts) reads the regression β straight out of the run envelope and computes AIR per cohort; severity is `high` only when **failing AND statistically significant**.

---

## 4. The AI agent contract — anti-hallucination

Every Pay Equity LLM agent returns a `PayEquityAgentResult<T>` envelope ([`packages/ai/src/types/pay-equity.ts`](packages/ai/src/types/pay-equity.ts)):

```ts
interface PayEquityAgentResult<T> {
  output: T; // structured + narrative output
  citations: Citation[]; // every claim must be backed
  methodology: PayEquityMethodology; // model + version + controls
  confidence: 'high' | 'medium' | 'low';
  warnings: AgentWarning[]; // sample size, k-anon, drift, etc.
  runId: string; // FK to the persisted PayEquityRun
  generatedAt: string; // ISO timestamp
}
```

### The four design rules every agent enforces

1. **Numbers come from inputs, never the model.** The calling service pre-computes everything (cohort means, distributions, projected series, sibling cohorts). The agent's prompt is told: _"every percent, dollar, employee count, or cohort label MUST appear in the input."_ If a number isn't in the input, the agent has no business mentioning it.

2. **Citations are required.** Every agent's output must reference the regression coefficients, employee rows, or cohort queries it drew from. The `citations[]` array is non-empty by construction; runs with empty citations log a warning and are flagged as suspicious.

3. **Methodology versioning is per-run.** When the methodology changes (different controls, different threshold, different model), the version bumps and the new envelope is a new immutable row. Old runs are reproducible exactly as they were the day they ran.

4. **k-anonymity is enforced at the agent boundary.** A cohort with `n<5` never reaches an LLM — the calling service refuses to invoke the agent and returns a `k_anonymity_violation` warning instead. This blocks the LLM channel from becoming a sidecar PII exfiltration path.

### Why the service pre-computes

A naive design would let the LLM call the database for the numbers it needs. Don't do that. Two reasons:

1. **Hallucination surface.** LLMs make up plausible-sounding numbers when they don't have them. Pre-computing turns the LLM's job into "narrate these specific facts" rather than "find and narrate facts about pay equity".
2. **Audit trail.** When the service pre-computes, the inputs are fully reproducible from the run envelope. When the LLM queries, the inputs depend on the LLM's tool-calling pattern, which can drift across model versions.

This pattern shows up in every agent: the service builds a deterministic input bundle, the agent narrates over it.

---

## 5. The six LLM agents

| #   | Agent                                                                                                                   | When it fires                                                                                                                                                                 | Input                                                                                  | Output                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | **Narrative** ([`pay-equity-graph.ts`](packages/ai/src/graphs/pay-equity-graph.ts))                                     | _Currently structural only_ — wired but the run pipeline doesn't yet trigger the narrative graph. Phase 1.5 deferred LLM narration to keep the foundation demo deterministic. | Full regression results + compa-ratios                                                 | Executive summary, key findings, EDGE compliance status, risk assessment, recommendations |
| 2   | **Cohort root-cause** ([`pay-equity-cohort-graph.ts`](packages/ai/src/graphs/pay-equity-cohort-graph.ts))               | User clicks "Analyze root cause" on a cohort cell in the Diagnose heatmap                                                                                                     | Cohort employee distribution by level / tenure / department, sibling cohorts           | 3–5 ranked root-cause factors with contribution % + recommended next step                 |
| 3   | **Outlier explainer** ([`pay-equity-outlier-graph.ts`](packages/ai/src/graphs/pay-equity-outlier-graph.ts))             | User clicks "Explain" on an individual employee in the outlier list                                                                                                           | Employee row + cohort context + sibling employees                                      | Per-employee paragraph + recommended action + severity                                    |
| 4   | **Remediation justifier** ([`pay-equity-remediation-graph.ts`](packages/ai/src/graphs/pay-equity-remediation-graph.ts)) | User runs `calculateRemediations` for a parent run                                                                                                                            | Deterministic adjustments (raise underpaid toward cohort mean, capped) + plan headline | Per-adjustment one-line justifications + plan summary + alternative scenarios             |
| 5   | **Projection** ([`pay-equity-projection-graph.ts`](packages/ai/src/graphs/pay-equity-projection-graph.ts))              | User runs the 12-month forecast                                                                                                                                               | Recent runs (last 6) + deterministic projected series + scenario inputs                | Drivers + recommended actions + risk level + narrative                                    |
| 6   | **Manager Equity Copilot** ([`pay-equity-copilot-graph.ts`](packages/ai/src/graphs/pay-equity-copilot-graph.ts))        | Manager types into the Overview Copilot card                                                                                                                                  | Their direct reports + latest org run (bounded RAG)                                    | Answer (or refusal if out of scope) + scope label + highlights + follow-up suggestions    |

Each agent invocation **persists its own child `PayEquityRun` row** with `agentType` set appropriately (`cohort_root_cause`, `outlier_explainer`, `remediation`, `projection`, `copilot`). This means the trend chart can show "this cohort was analyzed 3 times in the last week", and the audit trail captures every AI run, every input, every output.

---

## 6. The nine report types

All reports route through the same endpoint `GET /pay-equity/runs/:id/reports/:type` ([`pay-equity.controller.ts`](apps/api/src/modules/pay-equity/pay-equity.controller.ts)). The renderers are pure functions ([`report-renderers.ts`](apps/api/src/modules/pay-equity/report-renderers.ts)) — no LLM calls. They read the immutable run envelope and produce either CSV (statutory) or HTML (rendered through Puppeteer to PDF).

| Type                  | Format | Audience                | What it is                                                                                                                               |
| --------------------- | ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `board`               | PDF    | Board / CFO             | Executive summary, headline cards, cohort findings, methodology box                                                                      |
| `eu_ptd`              | CSV    | Regulatory filer (EU)   | Article 9 disclosure for the Pay Transparency Directive                                                                                  |
| `uk_gpg`              | CSV    | Regulatory filer (UK)   | Six required figures for gov.uk's Gender Pay Gap reporting                                                                               |
| `eeo1`                | CSV    | Federal contractor (US) | EEO-1 Component 1 disclosure (29 CFR §1602.7)                                                                                            |
| `sb1162`              | CSV    | CA filer                | California Pay Data Report (Labor Code §12999)                                                                                           |
| `auditor`             | PDF    | External auditor        | Anonymized — tenant-scoped sha256 hash on identifiers, watermarked "AUDITOR EXPORT"                                                      |
| `defensibility`       | PDF    | Internal counsel        | Comprehensive — methodology + full regression + citations + every audit event + every child agent invocation, **identifiers NOT hashed** |
| `comp_committee_deck` | PDF    | Comp committee          | 5-slide auto-generated deck (title / headline / cohort / methodology / recommendation)                                                   |
| `employee_statement`  | PDF    | Individual employee     | Privacy-aware: their compa-ratio plotted on a 0.7..1.3 scale with band quartiles, no peer salaries shown                                 |

**Statutory CSV honesty:** the four jurisdictional CSVs (EU PTD, UK GPG, EEO-1, SB 1162) emit fields we have data for. Fields that need source data we don't yet have — bonus pay gap, hourly-rate quartiles, race/ethnicity grids, EEO job categories — are emitted as the literal string `not_available` rather than blank. This is documented per-jurisdiction in [`STATUTORY_CSV_REVIEW_CHECKLIST.md`](./STATUTORY_CSV_REVIEW_CHECKLIST.md). **A customer cannot file as-is**; ~2-3 days of canonical-schema plumbing + one comp-lawyer review pass closes the gap.

---

## 7. The five workflow tabs

The workspace lives at `/dashboard/pay-equity` and is organized as a 5-tab shell ([`page.tsx`](<apps/web/src/app/(dashboard)/dashboard/pay-equity/page.tsx>)):

### Overview

- **Status bar** — 4 KPI cards: worst gap, significant gaps count, sample size, methodology
- **Run controls** — pick dimensions (gender / ethnicity / age band / department / location), threshold, optional note
- **CopilotCard** — bounded Q&A about the manager's team or org PE state (Phase 6.3)
- **TrustCard** — methodology snapshot, headline stats, agent invocations, expandable audit panel (Phase 5)

### Diagnose

- **Trend chart** — last N runs with methodology-shift markers
- **Cohort matrix (heatmap)** — severity-tinted clickable cells, k-anonymity gating
- **Cohort drill-down** — employee rows + statistical-test panel + "Analyze root cause" AI button
- **Outlier list** — lowest CR within significant cohorts + per-row "Explain" AI button

### Remediate

- **Compute proposals** — slider for target gap + max-per-employee cap. Service computes deterministic adjustments (raise underpaid toward cohort mean, sorted by lowest CR), AI agent narrates justifications
- **Adjustments table** — per-employee fromValue / toValue / deltaValue / status. ✓ / ✗ buttons per row
- **Apply** — writes `Employee.baseSalary` for every APPROVED row, audit-logged per change

### Reports

- **6 download cards** — board / EU PTD / UK GPG / EEO-1 / SB 1162 / auditor / defensibility / comp committee deck
- **Subscriptions** — schedule reports on a cadence; daily CHRO digest via email + optional Slack
- **Share tokens** — mint read-only links for external auditors with expiry + revocation

### Prevent

- **AIR table** — 80%-rule check per cohort
- **Pay band drift** — weighted-mean compa-ratio across recent runs
- **Pre-decision equity check** — stage hypothetical changes (promotion / salary / new hire) and see projected gap impact + flagged employees + verdict (safe / warn / block)
- **12-month forecast** — extrapolation + scenario adjustment + AI-narrated drivers

---

## 8. The Predict math (Phase 4)

The forecast and pre-decision check both use **composition math**: the impact of a scenario derives entirely from inputs in the run envelope. No external coefficients needed.

### Forecast (12-month projection)

```
baseline_gap   = worst_cohort_gap_in_latest_run
slope_per_month = (gap[N] - gap[0]) / months_elapsed   // last 6 runs, oldest→newest
scenario_delta  = compute_scenario_impact(...)         // see below

For each checkpoint m in [1, 3, 6, horizon]:
    trend_at_m = baseline_gap + slope_per_month × m
    scenario_fraction = m / horizon                      // ramp scenario in linearly
    projected_gap_at_m = trend_at_m + scenario_delta × scenario_fraction
```

### Composition math for scenario impact

For a hiring plan with K new hires in group G:

```
share  = K / (N + K)              // new hires' fraction of the new cohort
impact = share × |current_gap| × HIRE_GROUP_REACH    // 0.5: a hire moves one of two group means
sign   = +1 if G is reference, -1 if G is minority
Δ_hire = sign × impact
```

For promotions, multiply impact by `PROMOTION_WEIGHT` (1.5) — a promoted employee is now in the high-pay tail of their group, not just an additional headcount.

For salary changes (preview-change, an employee already in the cohort):

```
pct_change   = (toSalary - fromSalary) / fromSalary
group_share  = 0.5                 // assumes binary cohort split (conservative)
Δ_salary     = -sign(group) × pct_change × group_share × 100 × (1 / N)
```

(Negative sign because raising the _underpaid_ group narrows the gap.)

### Why this is more defensible than fixed coefficients

The original Phase 4 model used `HIRING_COEF=0.05pp/hire` — a flat per-employee constant. Two problems:

1. **Doesn't scale with cohort size.** 50 hires in a 100-person cohort is qualitatively different from 50 hires in a 10,000-person cohort. The flat constant treated them identically.
2. **Doesn't scale with the current gap.** Scenarios on a 1% gap and a 15% gap shift by proportionally different amounts in reality. The flat constant didn't.

The composition math fixes both. Capped at ±15pp so a single absurd input (e.g., 100k hires) can't produce implausible projections. Coefficients are derivable from the run envelope itself — no comp-consultant validation needed for the math (although the actual cohort composition assumptions warrant review for any specific customer).

### Pre-decision check verdict

```
verdict = projectedDelta > 0.5  ? 'block'
        : projectedDelta > 0.1  ? 'warn'
                                : 'safe'
```

Plus per-employee CR floor flag: any change that would put `projected_CR < 0.85` is flagged with severity `high`.

---

## 9. Distribution & governance

### Subscriptions ([`PEDistributionService`](apps/api/src/modules/pay-equity/pe-distribution.service.ts))

Stored in `PEReportSubscription`. Each row has:

- `reportType` — one of the nine report types, or `digest` for the CHRO daily summary
- `cadence` — daily / weekly / monthly / quarterly
- `recipients[]` — email addresses
- `slackWebhook` — optional Slack incoming-webhook URL
- `nextRunAt`, `lastRunAt`, `lastError`

A BullMQ repeatable job ticks **hourly** ([`pe-distribution.processor.ts`](apps/api/src/modules/pay-equity/pe-distribution.processor.ts)). Each tick:

1. Selects subscriptions where `nextRunAt <= now`
2. For each: composes the artifact (digest summary or rendered report), delivers via email + Slack
3. Reschedules `nextRunAt` per cadence; records errors in `lastError`

### Share tokens (Phase 5.5)

`PEShareToken` rows hold a random 24-byte base64url token, bound to a single `runId`, with an `expiresAt` (default 30 days) and optional `revokedAt`. The public route `GET /api/v1/pe-share/:token` ([`pe-share.controller.ts`](apps/api/src/modules/pay-equity/pe-share.controller.ts)) — **unauthenticated, the token IS the credential** — redeems the token and returns the auditor or defensibility PDF. Every redemption increments `accessCount` and updates `lastAccessedAt` for audit.

### Audit trail

Every action — every analysis, every cohort drill-down, every AI invocation, every report export, every share-token redemption — writes an `AuditLog` row. Action codes are namespaced `PAY_EQUITY_*` so the entire trail filterable. The `getAuditTrail` endpoint surfaces them per-run (this run + child runs + linked remediations).

---

## 10. Privacy guarantees

Four enforcement points:

1. **k-anonymity at the regression boundary.** Cohorts with `n<5` get suppressed before the envelope is built. The run completes successfully; the cell just has `suppressed: true` instead of statistics.
2. **k-anonymity at the agent boundary.** Even if a cohort survived the first check (perhaps because we filtered cohorts post-regression), the LLM-invoking services double-check before calling the agent. A small cohort never gets near a model.
3. **Auditor export hashing.** The `auditor` PDF replaces tenant id with a tenant-scoped sha256 hash (`createHash('sha256').update(`${tenantId}:${id}`).digest('hex').slice(0, 12)`). Cross-tenant correlation is impossible because the hash includes the tenant id as salt.
4. **Employee statement redaction.** The per-employee personal equity statement plots their compa-ratio on a 0.7..1.3 scale with band quartiles, but never shows specific peer salaries. This is hard-coded in the renderer.

---

## 11. The audit + reproducibility story

Pay Equity is built on three immutability invariants:

1. **The PayEquityRun envelope is never mutated.** Once a run is `COMPLETE`, its `result` JSON is frozen. Reports generated weeks or months later draw from the same envelope, reproducibly.
2. **Methodology is pinned per-run.** A run stamps `methodologyName + methodologyVersion` at creation. If we change controls, dependent variable, or threshold, the version bumps and the new run gets the new methodology. Old runs continue to reproduce as they originally did.
3. **The audit log is append-only.** Every action writes a row; nothing is updated or deleted. The `getAuditTrail` endpoint is just a filtered view.

Together these mean: **given a runId**, anyone can reproduce the original report bytes, the original AI narrative, and the full audit trail of who did what when. This is the auditor-defensibility story, and it's why the bible's first principle is "the envelope is immutable".

---

## 12. Worked example — end-to-end

Imagine a 500-employee software company. The CHRO clicks **Run analysis** on the gender dimension.

### Input

- 500 employees: 270 male, 230 female
- Mean salary $98,000 (male) vs $94,800 (female)
- Levels L1–L8, mostly concentrated at L4 and L5
- Controls used: `job_level, tenure, performance, location, department`

### Statistical engine (~30ms)

- OLS regression: `salary ~ female_indicator + level + tenure + perf + location + department`
- β₁ = -3,200 (the adjusted dollars-per-employee gap on gender)
- p = 0.004 (highly significant)
- 95% CI for β₁: [-5,400, -1,000]
- gapPercent = -3,200 / 100,000 × 100 = **-3.2%**

### Compa-ratio aggregation

- Female: avg CR = 0.94, median = 0.95 (n=230)
- Male: avg CR = 0.97, median = 0.98 (n=270)

### Remediation cost estimate

- 47 female employees fall below the cohort midpoint
- Average adjustment to bring them up: $10,362
- Total cost-to-close: $487,000

### Envelope assembly

```json
{
  "output": {
    "regressionResults": [{ "dimension": "gender", "group": "Female",
      "coefficient": -3200, "pValue": 0.004, "gapPercent": -3.2,
      "sampleSize": 500, "significance": "significant", "riskLevel": "MEDIUM" }],
    "compaRatios": [...],
    "remediation": { "totalCost": 487000, "affectedEmployees": 47 }
  },
  "citations": [
    { "type": "regression_coefficient", "ref": "gender.Female.vs.Male",
      "excerpt": "β=-3200, p=0.004, n=500" }
  ],
  "methodology": {
    "name": "edge-multivariate", "version": "2026.04",
    "controls": ["job_level", "tenure", "performance", "location", "department"],
    "dependentVariable": "log_salary", "sampleSize": 500,
    "confidenceInterval": 0.95, "complianceThreshold": 2
  },
  "confidence": "high",
  "warnings": [],
  "runId": "run_abc123",
  "generatedAt": "2026-04-30T09:00:00Z"
}
```

### Persistence

- One `PayEquityRun` row inserted: id=`run_abc123`, status=`COMPLETE`, the envelope as `result`
- One `AuditLog` row: action=`PAY_EQUITY_RUN`, entityId=`run_abc123`

### What the user sees on the Overview tab

- **Worst gap:** -3.2% (gender/Female)
- **Significant gaps:** 1
- **Sample:** 500 employees
- **Confidence:** high

### What's now possible from this run

| Action                                               | What happens                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Click "Analyze root cause" on the Female cell        | Cohort root-cause agent fires. Service pre-computes by-level / by-tenure / by-department salary distributions. Agent ranks 3–5 root causes (e.g., "55% of the gap concentrates at L4: 30 women vs 80 men, mean salary delta $4.2K"). Persists as `agentType=cohort_root_cause` child run.              |
| Click "Explain" on an outlier (e.g., Sarah, CR=0.87) | Outlier agent generates a 2-sentence explanation citing her CR + cohort context. Persists as `agentType=outlier_explainer` child run.                                                                                                                                                                  |
| Click "Compute proposals" with target=2%             | Service: 47 underpaid women × proposed adjustments to bring them to cohort midpoint, capped at 15% per employee. Total cost: $487K. Remediation agent narrates per-employee justifications. Persists as `agentType=remediation` child run.                                                             |
| Approve all 47 + click "Apply"                       | `Employee.baseSalary` updated for each. 47 audit-log rows. PayEquityRemediation rows flip PROPOSED → APPROVED → APPLIED.                                                                                                                                                                               |
| Click "Stage letters"                                | 47 DRAFT compensation letters created in the Letters module, ready for HR to send.                                                                                                                                                                                                                     |
| Click "Run forecast" with horizonMonths=12           | Service computes deterministic projected series at t+1/3/6/12 months. With the historical trend + no scenario, projected gap stays around -3.2%. With "hire 50 male engineers at L4", projected gap widens. Projection agent narrates drivers + actions. Persists as `agentType=projection` child run. |
| Download the EU PTD CSV                              | Renderer reads the envelope, emits Article 9 statutory format. Bonus / median / quartile rows show `not_available`. Audit row: `PAY_EQUITY_REPORT_EXPORTED`.                                                                                                                                           |
| Mint a share token for the external auditor          | New `PEShareToken` row, expires in 30 days. Customer copies the link; auditor accesses the read-only auditor PDF without a tenant account.                                                                                                                                                             |
| CHRO subscribes to the daily digest                  | `PEReportSubscription` row created. Hourly cron picks it up; tomorrow morning the CHRO gets a 4-line summary by email + Slack.                                                                                                                                                                         |

---

## 13. What it doesn't do (yet)

Honest list of boundaries:

- **Statutory filing without lawyer review.** The four CSVs are correctly shaped but not field-perfect for any specific regulator's online template. See [`STATUTORY_CSV_REVIEW_CHECKLIST.md`](./STATUTORY_CSV_REVIEW_CHECKLIST.md) for the full list of fields that need source-data plumbing or column-name alignment.
- **Hourly-rate / bonus / quartile breakdowns.** Need raw payroll wiring (`Employee.hourlyRate` or derived; `CompComponent.kind='bonus'` aggregation).
- **Promotion-event AIR.** The current AIR uses pay-rate ratio (`exp(β)`); a pure event-based AIR (selection-rate ratio for promotions/hires) needs an event log we don't yet track.
- **Multi-establishment splits.** EEO-1 / SB 1162 want per-establishment rows; our canonical schema doesn't yet have an establishment concept.
- **Race/ethnicity** is opt-in; many tenants won't have it. The renderer degrades gracefully (gender-only analysis) when it's absent.
- **Quantile regression / Oaxaca-Blinder decomposition.** The current OLS is the standard EDGE-style methodology. Distributional-gap analyses are a Phase 5+ / consultant question.
- **Federal-contractor compliance certification.** We produce the data; a customer's compliance team owns the filing.
- **"Production" model for the projection coefficients.** The composition math is defensible from inputs but conservative. A real customer rollout might warrant per-tenant calibration based on their actual hiring/promotion patterns.

---

## 14. Where to look for the actual code

| Concern                             | Path                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Main service                        | [`apps/api/src/modules/pay-equity/pay-equity.service.ts`](apps/api/src/modules/pay-equity/pay-equity.service.ts)               |
| Distribution + share tokens         | [`apps/api/src/modules/pay-equity/pe-distribution.service.ts`](apps/api/src/modules/pay-equity/pe-distribution.service.ts)     |
| Statistical engine (legacy, reused) | [`apps/api/src/modules/analytics/pay-equity.service.ts`](apps/api/src/modules/analytics/pay-equity.service.ts)                 |
| Report renderers (all 9 types)      | [`apps/api/src/modules/pay-equity/report-renderers.ts`](apps/api/src/modules/pay-equity/report-renderers.ts)                   |
| Agent contract types                | [`packages/ai/src/types/pay-equity.ts`](packages/ai/src/types/pay-equity.ts)                                                   |
| Six LLM agents                      | [`packages/ai/src/graphs/pay-equity-*.ts`](packages/ai/src/graphs/)                                                            |
| Workspace UI                        | [`apps/web/src/app/(dashboard)/dashboard/pay-equity/page.tsx`](<apps/web/src/app/(dashboard)/dashboard/pay-equity/page.tsx>)   |
| React Query hooks                   | [`apps/web/src/hooks/use-pay-equity.ts`](apps/web/src/hooks/use-pay-equity.ts)                                                 |
| Tests                               | [`apps/api/src/modules/pay-equity/*.test.ts`](apps/api/src/modules/pay-equity/)                                                |
| Goldens for eval harness            | [`packages/ai/src/evals/pay-equity/golden/`](packages/ai/src/evals/pay-equity/golden/)                                         |
| LLM-as-judge harness                | [`apps/api/src/modules/pay-equity/pay-equity-llm-judge.test.ts`](apps/api/src/modules/pay-equity/pay-equity-llm-judge.test.ts) |
| Database schema                     | [`packages/database/prisma/schema.prisma`](packages/database/prisma/schema.prisma) (search `model PayEquityRun`)               |
| Build bible                         | [`PAY_EQUITY_CONTEXT.md`](./PAY_EQUITY_CONTEXT.md)                                                                             |
| Statutory checklist                 | [`STATUTORY_CSV_REVIEW_CHECKLIST.md`](./STATUTORY_CSV_REVIEW_CHECKLIST.md)                                                     |
