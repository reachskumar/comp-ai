# Statutory CSV Review Checklist

> **Purpose:** make the comp-lawyer review of the four statutory CSV exports (EU PTD, UK GPG, EEO-1, CA SB 1162) as fast and cheap as possible. This file lays out, per export, what we currently emit, what regulators require, and the concrete code-level changes needed for a customer to file as-is.
>
> Self-audited 2026-04-30 by Claude. **Not a substitute for legal sign-off** — when a customer wants to actually file, route this checklist + the produced CSV to a comp/employment lawyer for the named jurisdiction. The points below are the schema-level findings, not legal advice.
>
> Companion to `PAY_EQUITY_CONTEXT.md` (Pay Equity build bible) and the renderers at `apps/api/src/modules/pay-equity/report-renderers.ts`.

---

## How the renderers work

- Each statutory export is rendered from the **immutable PayEquityRun envelope** (regression results + compa-ratios + overall stats). No re-computation, no LLM.
- Fields we don't have source data for are emitted as the literal string `not_available` (vs. blank) so the consumer immediately sees "feature gap" instead of "looks like a bug".
- Header rows are prefixed `#` with metadata (tenant, run id, methodology version, snapshot date) — comparable to the metadata blocks regulators include in their templates.
- All CSVs are BOM-prefixed UTF-8 so Excel opens them in UTF-8 instead of cp1252.

---

## 1. EU Pay Transparency Directive (Directive (EU) 2023/970)

### Statutory anchor

- Directive (EU) 2023/970, Article 9 ("Reporting on the pay gap between female and male workers")
- Enforced **June 2026** for employers with ≥150 workers; lower thresholds phase in through 2031

### What Article 9 requires

1. Pay gap between female and male workers (mean + median, hourly rate)
2. Pay gap in complementary or variable components (bonus, allowances, equity)
3. Proportion of female vs male workers receiving complementary/variable components
4. Pay gap by quartile pay band
5. **Pay gap between female and male workers by category of workers performing the same work or work of equal value** ← the EU PTD-specific bit; categories defined per employer

### What we emit today (`renderEuPtdCsv`)

- ✅ Article 9 metadata header (directive citation, tenant, run id, reporting period, methodology, total employees)
- ✅ Per-cohort row with: `category_of_workers, protected_class_dimension, protected_class_group, reference_group, sample_size, mean_pay_gap_percent, p_value, significance, risk_level`
- ⬜ `median_pay_gap_percent` → `not_available` (needs raw hourly-rate dataset)
- ⬜ `bonus_pay_gap_percent` → `not_available` (needs `CompComponent.bonus` breakdown)
- ⬜ `share_receiving_bonus_percent` → `not_available` (needs `CompComponent.bonus` breakdown)
- ⬜ Quartile breakdown rows → not currently emitted

### Concrete gaps a customer needs filled before filing

1. **Median calculation:** add a service path that computes weighted-median salary by group from the legacy analyzer's raw employee load. The compute is ~20 lines; the missing piece is plumbing the raw dataset to the renderer.
2. **Bonus pay gap:** add `CompComponent` table queries; compute mean+median bonus separately. Schema additions: `CompComponent.kind = 'bonus'` already supported in the canonical model.
3. **Quartile pay band breakdown:** sort all employees by hourly rate, split into 4 equal-size bands, count gender mix per band. ~30 lines.
4. **Category of workers:** the directive mandates that the employer defines categories of "equal value" (not the regulator). Today we emit `'all_workers'` as the literal value — needs a tenant-config mapping (Employee.jobFamily + Employee.level + Employee.responsibilityLevel → category) before filing.

### Lawyer review questions

- [ ] Does our `protected_class_dimension`/`protected_class_group` framing match what an EU PTD filer would expect? (We use generic labels; the directive expects gender as the explicit dimension.)
- [ ] The directive permits the `category of workers` to be employer-defined — confirm our jobFamily+level mapping satisfies "same work or work of equal value".
- [ ] Is the methodology citation block (model + controls) acceptable as a transparency statement to satisfy Article 9(3)?
- [ ] Does the file need an explicit conformity statement (e.g., a header row asserting "this report has been produced under Article 9(2)")?

---

## 2. UK Gender Pay Gap (Equality Act 2010 + 2017 Regulations)

### Statutory anchor

- Equality Act 2010 (Gender Pay Gap Information) Regulations 2017 (SI 2017/172)
- Annual snapshot at 5 April (private sector) / 31 March (public sector) for employers with ≥250 employees on the snapshot date
- Reported via gov.uk's online service, formatted to their CSV template

### What gov.uk requires (the six required figures)

1. Mean gender pay gap (%) using hourly rate
2. Median gender pay gap (%) using hourly rate
3. Mean bonus gender pay gap (%)
4. Median bonus gender pay gap (%)
5. Proportion of male / female receiving bonus pay (%)
6. Pay quartile breakdown — % male and % female in each of 4 pay quartiles

### What we emit today (`renderUkGpgCsv`)

| Field                                                                 | Status             | Notes                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mean_gender_pay_gap_percent`                                         | ✅                 | Derived from regression coefficient on gender. Caveat: gov.uk wants mean of hourly rates, ours is a regression β converted to %. Customer-facing filer should compute true mean separately. |
| `median_gender_pay_gap_percent`                                       | ⬜ `not_available` | Needs raw hourly-rate dataset                                                                                                                                                               |
| `mean_bonus_pay_gap_percent`                                          | ⬜ `not_available` | Needs `CompComponent.bonus`                                                                                                                                                                 |
| `median_bonus_pay_gap_percent`                                        | ⬜ `not_available` | Needs `CompComponent.bonus`                                                                                                                                                                 |
| `proportion_male_receiving_bonus_percent`                             | ⬜ `not_available` | Needs `CompComponent.bonus`                                                                                                                                                                 |
| `proportion_female_receiving_bonus_percent`                           | ⬜ `not_available` | Needs `CompComponent.bonus`                                                                                                                                                                 |
| 8× quartile cells (lower / lower-middle / upper-middle / upper × M/F) | ⬜ `not_available` | Needs raw hourly-rate dataset                                                                                                                                                               |

### Concrete gaps before customer filing

1. Compute the six gov.uk figures from raw employee hourly rates (the legacy analyzer has them) — wire into the renderer.
2. Bonus gap requires `CompComponent` join for kind=`bonus`, including non-zero filter. Both schema-supported; just plumbing.
3. **Hourly rate definition** matters: gov.uk uses contractual gross hourly pay including allowances, excluding overtime + redundancy + termination payments. Our `Employee.baseSalary` is annual salary — needs `÷ contractualHoursPerYear` (which we don't store). Add `Employee.contractualHoursPerWeek` to canonical schema before filing.
4. The gov.uk online filing form uses specific column headers (PascalCase, e.g., `MeanBonusGenderPayGap`) — our snake_case won't import. Either rename for the export or add a column-name mapper at upload time.

### Lawyer review questions

- [ ] Confirm our derivation of the mean gap (regression β converted to %) is acceptable as the gov.uk "mean gender pay gap" figure, or insist on direct mean-of-hourly-rates.
- [ ] Snapshot date handling: we emit `Snapshot date = run created at`. The 2017 Regulations require **5 April** for private sector. Add explicit snapshot-date config per tenant before filing.
- [ ] Quartile definition: the 2017 Regs' "Schedule 1, paragraph 12" specifies "ranking employees by hourly pay and dividing into four equal sections". Confirm our forthcoming quartile implementation matches this exactly.
- [ ] Confirm whether our column names need to match gov.uk template casing (`MeanGenderPayGap` vs `mean_gender_pay_gap_percent`).

---

## 3. EEO-1 Component 1 (US — Federal Contractors)

### Statutory anchor

- 29 CFR §1602.7 (EEOC) + Section 709(c) of Title VII
- Required of employers with ≥100 employees + federal contractors with ≥50
- Filed annually via the EEOC's online portal, with a specific 10-job-category × 14-race/ethnicity-and-sex grid

### EEO-1 grid structure (what regulators expect)

**10 EEO job categories:**

1. Executive/Senior Level Officials and Managers
2. First/Mid Level Officials and Managers
3. Professionals
4. Technicians
5. Sales Workers
6. Administrative Support Workers
7. Craft Workers
8. Operatives
9. Laborers and Helpers
10. Service Workers

**14 race/ethnicity × sex cells per category:**

- Hispanic or Latino: M, F
- Not Hispanic or Latino × {White, Black or African American, Native Hawaiian or Pacific Islander, Asian, American Indian or Alaska Native, Two or More Races}: M, F each = 12 cells

= **140-cell grid** per establishment, plus an "Overall Totals" row.

### What we emit today (`renderEeo1Csv`)

- ✅ EEO-1 metadata header (29 CFR citation, tenant, run id, reporting period, total employees)
- ✅ Per-cohort row with: `eeo_job_category, race_ethnicity, sex, cohort_dimension, cohort_group, employee_count, gap_percent_vs_reference, reference_group`
- ⬜ `eeo_job_category` → emitted as `not_available` for every row (we lack the canonical mapping)
- ⬜ `race_ethnicity` → only populated when the source dimension is literally `race`/`ethnicity`; otherwise `not_available`
- ⬜ The required 10×14 grid layout — currently we emit one row per cohort, not the 10×14 matrix EEOC expects

### Concrete gaps before customer filing

1. **EEO job category mapping:** need a per-tenant config that maps `Employee.level` + `Employee.responsibilityLevel` + `Employee.functionType` → one of the 10 EEO categories. ~50 LOC of mapping table + UI to configure.
2. **Race/ethnicity field:** schema already has `Employee.race` + `Employee.ethnicity` (optional). The renderer needs to emit the 14-way breakdown when populated; today we only handle one dimension at a time.
3. **Grid layout:** the EEOC online portal expects a specific row layout (10 category rows × 14 cells per row + a totals row). Our current "one row per cohort" output is parseable but not directly uploadable. Either rewrite the renderer to emit the grid format, or build a transformer at upload.
4. **Establishment splitting:** EEO-1 requires per-establishment rows for multi-site employers. We have no `Employee.establishmentId` concept yet — would need to add to the canonical schema OR derive from `Employee.location`.

### Lawyer review questions

- [ ] Confirm that mapping `Employee.responsibilityLevel` (TOP/UPPER/MIDDLE/JUNIOR/OPERATIONAL — EDGE convention) → EEO categories 1-10 is a reasonable equivalence, or insist on a separate explicit field.
- [ ] Does our handling of "two or more races" matter — do we treat it as a single cell or split? The EEOC spec is explicit; confirm match.
- [ ] Is the metadata header acceptable, or does the EEOC portal require a strictly fixed top-of-file format?
- [ ] For multi-establishment employers, what is the minimum viable definition of `establishment` we can derive from `location`?

---

## 4. California SB 1162 (Pay Data Report — Labor Code §12999)

### Statutory anchor

- Labor Code §12999 (added by SB 1162, 2022)
- Required of employers with ≥100 employees in California or contracted to ≥100 California workers
- Filed annually via the CRD (Civil Rights Department) Pay Data Reporting portal by the second Wednesday of May

### What CRD requires

- Establishment-level rows (one row per CA establishment)
- Within each establishment, a grid by:
  - 10 EEO job categories (same as EEO-1)
  - 7 race/ethnicity × 2 sex categories (slight differences from EEO-1's "Hispanic or Latino" framing)
  - 12 pay bands (US Bureau of Labor Statistics ranges)
- Per cell: number of employees + **mean hourly rate + median hourly rate**

### What we emit today (`renderSb1162Csv`)

- ✅ SB 1162 metadata header (Labor Code §12999 citation, tenant, run id, reporting period, total employees)
- ✅ Per-cohort row with: `establishment_id, eeo_job_category, race_ethnicity, sex, pay_band, employee_count, mean_hourly_rate, median_hourly_rate, cohort_dimension, cohort_group, gap_percent_vs_reference`
- ⬜ `establishment_id` → `not_available` (no canonical concept yet)
- ⬜ `eeo_job_category` → same gap as EEO-1 above
- ⬜ `pay_band` → `not_available` (no BLS-band mapping)
- ⬜ `mean_hourly_rate` / `median_hourly_rate` → `not_available` (need raw rates)

### Concrete gaps before customer filing

1. **All four** of the EEO-1 gaps above (job category + race/ethnicity + establishment + raw rates) apply equally here — fixing EEO-1 unblocks SB 1162.
2. **Pay band mapping:** add a constant table of the 12 BLS pay ranges (currently `<$24,439`, `$24,440-$30,679`, ... `>$208,000`). Rendering becomes O(1) once we have hourly rates.
3. **Mean + median hourly rate per cell:** straightforward aggregation once raw rates are available.

### Lawyer review questions

- [ ] CRD has historically allowed both "snapshot" and "annualized" pay data — confirm which our renderer should target.
- [ ] The "mean of mean hourly rates" within an establishment vs the establishment-wide mean — confirm the formula CRD wants.
- [ ] CRD pay bands are based on calendar-year W-2 Box 5 earnings. Our base-salary derivation may diverge for partial-year employees, equity vesting, etc. — confirm the lawyer is comfortable with our reconciliation approach.

---

## What unblocks all four reports at once

**One canonical-schema addition unlocks ~80% of the gaps:** adding raw `Employee.hourlyRate` (or deriving it from `baseSalary / contractualHoursPerYear`) makes mean + median + quartile + pay-band + per-cell rate computations possible across all four exports.

**One config addition unlocks the other ~20%:** a per-tenant `EEOJobCategoryMapping` (jobFamily / level / responsibilityLevel → EEO category 1-10) covers EEO-1, SB 1162, and the EU PTD's "category of workers" requirement.

**One audit before customer filing per jurisdiction:** the lawyer review confirms (a) the column names match the regulator's portal template, (b) the snapshot date / reporting period framing is correct, (c) any required conformity statements are present.

Total work to "customer can file as-is": ~2-3 days of canonical-schema + renderer plumbing, plus the legal sign-off the lawyer review produces. The export pipeline + audit trail + methodology framing are all production-ready today.
