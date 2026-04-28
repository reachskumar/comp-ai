# Compport AI — Feature Capability Plan

**Status:** Draft v2 · Owner: Santosh · Last updated: 2026-04-27

For every feature in the product, this document lists the capabilities that
must exist for it to be "100% workable, best in industry." Each capability
is a checkbox. Tick as you ship.

**Legend:** ✅ done · 🟡 partial · ⬜ not started · ❓ needs audit · ⛔ blocked

**Anchors** — best-in-industry comparison points are noted per feature.
These are where we want to match or beat.

---

## Table of contents

1. [Compensation Cycles](#1-compensation-cycles) — anchor: Workday Advanced Comp / Lattice
2. [AI Copilot](#2-ai-copilot) — anchor: Glean / ChatGPT Enterprise
3. [Pay Equity](#3-pay-equity) — anchor: Trusaic / Syndio
4. [Total Rewards / My Rewards Portal](#4-total-rewards--my-rewards-portal) — anchor: Compa / OpenComp
5. [Letters](#5-letters) — anchor: Lattice / DocuSign-grade
6. [Job Architecture](#6-job-architecture) — anchor: Workday / HRSoft
7. [Benefits](#7-benefits) — anchor: Workday / Bswift
8. [Equity](#8-equity) — anchor: Carta
9. [Reports](#9-reports) — anchor: Looker / Tableau (lite)
10. [Attrition](#10-attrition) — anchor: Visier / Eightfold
11. [Compliance](#11-compliance) — anchor: Trusaic / OneTrust
12. [Rules Engine](#12-rules-engine) — anchor: HRSoft / custom
13. [Payroll](#13-payroll) — anchor: ADP / Workday Payroll
14. [Benchmarking](#14-benchmarking) — anchor: Mercer / Radford / Pave
15. [Ad-hoc Increases](#15-ad-hoc-increases) — anchor: Workday
16. [Data Import & Hygiene](#16-data-import--hygiene) — anchor: Workato / native
17. [Integrations](#17-integrations) — anchor: Workato / Merge.dev
18. [Compport Bridge](#18-compport-bridge) — proprietary
19. [Notifications & Nudges](#19-notifications--nudges) — anchor: Lattice / Microsoft Viva
20. [Settings & Tenant Admin](#20-settings--tenant-admin) — anchor: Workday tenant admin
21. [Platform Admin](#21-platform-admin-internal) — internal
22. [Auth & Security](#22-auth--security) — anchor: Okta / Workday

---

## 1. Compensation Cycles

_Anchor: Workday Advanced Comp / Lattice. The most strategic feature — flagship._

### Cycle setup

- ✅ Create cycle (name, type, dates) + state machine (DRAFT → PLANNING → ACTIVE → CALIBRATION → APPROVAL → COMPLETED)
- ✅ Eligibility rules (tenure, performance rating, departments, locations, levels, exclude-terminated)
- ✅ Eligibility preview (count + sample of eligible employees before launch)
- ⬜ Cycle templates (clone last year's setup)
- ⬜ Multi-cycle running in parallel (e.g. annual + sales bonus)
- ⬜ Cycle calendar visualization

### Budget management

- ⬜ Budget pools by type (merit, market, promo, equity, retention, sign-on)
- ✅ Allocation by department (top-down)
- 🟡 Top-down vs bottom-up (top-down + budget-request endpoint; bottom-up UI pending)
- ⬜ Currency-aware budgets (multi-currency aggregation)
- 🟡 Budget guardrails (drift warnings via monitor; hard 100% block + override pending)
- ⬜ Mid-cycle budget reallocation
- ✅ Real-time budget remaining per department
- 🟡 Variance tracking (driftPct computed; no full plan-vs-actual report)

### Manager planning workspace

- ✅ See all direct reports (Employee.managerId via User.employeeId link)
- ✅ Propose increases inline (% or absolute, two-way bound)
- ⬜ Side-by-side compare to peers, market, salary band
- ✅ Budget remaining indicator (manager-scoped CycleBudget shown on the page)
- ✅ Comp ratio shown (range penetration TBD)
- ✅ Performance rating + tenure context
- ⬜ Last 3 increases history
- ✅ Bulk apply (e.g. apply 3% to everyone)
- ✅ Save draft (creates/updates CompRecommendation rows via existing bulk endpoint)
- 🟡 Justification field present; not yet required for out-of-band proposals

### Approvals

- 🟡 Multi-level approval chain (chain service exists; role routing is static array, not dynamic per-role org)
- ⬜ Conditional routing (over $X → extra approver)
- ✅ Bulk approve / reject
- ✅ Approve with comments / reject with reason
- ⬜ Recall / amend after submission
- ⬜ Delegation when approver is OOO
- ✅ Escalation when stuck > N days (scheduleEscalation service)
- 🟡 Notifications (in-app via NotificationService; no email yet)
- ⬜ Approver workload dashboard

### Calibration

- ⬜ Cross-manager comparison view (heatmap by team)
- ⬜ Forced distribution support (optional)
- ⬜ Live recompute as managers adjust
- ✅ Outlier detection (monitor service)
- 🟡 Side-by-side review session (sessions exist; multi-screen UX pending)
- ✅ Pre-calibration suggestions from AI (CalibrationAssistantGraph wired into aiSuggest)
- ✅ Calibration history (sessions persisted, lock/unlock state)

### AI recommendations

- ✅ Per-employee suggested increase (CalibrationAssistantGraph)
- ⬜ Reasoning shown ("flagged because comp ratio = 0.87")
- ⬜ Confidence score
- ✅ Bulk-apply recommendation with override (applyAiSuggestions)
- ⬜ Track manager acceptance rate (model feedback loop)

### Compliance + closure

- ⬜ Pay equity check before close (block if regression detected)
- ✅ Letter generation at close (opt-in `generateLetters` on transition; enqueues BullMQ batches per letter type, chunked to 100/batch)
- ✅ Writeback to Employee.baseSalary on closure (MERIT/PROMO/ADJUSTMENT, with audit log per change)
- 🟡 Final cycle report (cycle summary endpoint exists; full distribution / exception report pending)
- ✅ Audit trail per employee / per change (AuditLog rows on closure writeback)
- ⬜ Cycle archive + reopen for amendment

**Bar to ship:** Bar 6 (Tier A) · **Estimated effort:** 4–6 weeks

---

## 2. AI Copilot

_Anchor: Glean / ChatGPT Enterprise. The marquee differentiator._

### Conversation

- ✅ Chat UI with multi-turn
- ✅ Streaming responses
- ✅ Conversation history persisted per user
- ⬜ Conversation rename / pin / archive / share
- ⬜ Suggested follow-up questions
- ⬜ Suggested starter prompts for new users (per role)
- ⬜ Stop generation mid-stream

### Knowledge + tools

- 🟡 Tool use (query data) — exists, needs hardening
- ⬜ Citations (point to row / report / policy chunk)
- ⬜ "Why" / "Show your work" reasoning toggle
- ⬜ Multi-step tool chains (query → analyze → recommend)
- ⬜ Action-taking (approve raise, schedule cycle, send letter) with confirm step
- ⬜ Permission-aware (returns "you don't have access" not raw data)
- ⬜ Cite the comp policy when answering policy questions

### Quality

- ⬜ Hallucination guardrails (refuse to invent numbers)
- ⬜ Per-tenant prompt customization (tone, terminology)
- ⬜ Confidence display
- ⬜ User feedback (👍/👎) → fine-tune signal
- ⬜ Eval harness (regression suite of golden Q→A)

### Cost + ops

- ⬜ Per-tenant token budget + alerting
- ⬜ Per-user rate limits
- ⬜ Cost dashboard
- ⬜ Model selection per tenant (GPT-4o / Claude / cost-tier)
- ⬜ Conversation export

### UX

- ⬜ Mobile parity
- ⬜ Multi-language (UI + responses)
- ⬜ Voice input (optional)
- ⬜ Keyboard shortcuts
- ⬜ Inline data viz (small charts in answers)

**Bar to ship:** Bar 6 (Tier A) · **Estimated effort:** 3–4 weeks

---

## 3. Pay Equity

_Anchor: Trusaic / Syndio. Compliance-grade analytics._

### Analysis

- 🟡 Adjusted gap (controlling for level / tenure / location)
- 🟡 Unadjusted gap (raw)
- ⬜ Multi-dimensional cohorts (gender × race × level × location × function)
- ⬜ Statistical significance testing (regression p-values)
- ⬜ Sample-size warnings (refuse to report on n < threshold)
- ⬜ Time-series view (gap over last 8 quarters)
- ⬜ Drill-down to individual rows behind a gap

### Remediation

- ⬜ Auto-suggested adjustments to close gap
- ⬜ Cost-to-close calculator
- ⬜ Scenario modeling ("if we raise these 12 people by X, gap closes to Y")
- ⬜ Apply remediation as ad-hoc cycle

### Reporting

- ⬜ EEO-1 export (US)
- ⬜ UK Gender Pay Gap report (statutory format)
- ⬜ EU Pay Transparency Directive report
- ⬜ Board-ready PDF summary
- ⬜ Anonymized export for external auditors
- ⬜ Scheduled delivery (annual / quarterly)

### Governance

- ⬜ Methodology documentation (which model, which controls)
- ⬜ Audit log of report generations
- ⬜ Restricted access (role-gated)
- ⬜ Watermarked exports

**Bar to ship:** Bar 6 (Tier A) · **Estimated effort:** 4–6 weeks

---

## 4. Total Rewards / My Rewards Portal

_Anchor: Compa / OpenComp. Employee-facing._

### Statement

- 🟡 Total rewards statement (base + bonus + equity + benefits)
- ⬜ Year-over-year comparison
- ⬜ "What changed" callouts
- ⬜ Localized currency + tax notes
- ⬜ Plain-language explanations of each component
- ⬜ Visualizations (donut, stacked bar)

### Equity detail

- ⬜ Vesting schedule (with clear "today" marker)
- ⬜ Vested vs unvested split
- ⬜ Estimated value at current 409A
- ⬜ Tax impact estimator (configurable jurisdiction)
- ⬜ Exercise simulator

### Benefits detail

- ⬜ Per-plan utilization
- ⬜ Enrollment status
- ⬜ Coverage tier + dependents
- ⬜ Total employer cost
- ⬜ Open enrollment CTA when window active

### Performance + career

- ⬜ Performance rating history
- ⬜ Promotion / level changes timeline
- ⬜ Salary band visibility (where in the band employee sits)
- ⬜ Career ladder ("what's next")
- ⬜ Learning content links

### Output

- ✅ PDF download
- ⬜ Mobile-first responsive
- ⬜ Email delivery (annual statement)
- ⬜ Confidential watermark

**Bar to ship:** Bar 6 (Tier A) · **Estimated effort:** 3 weeks

---

## 5. Letters

_Anchor: Lattice / DocuSign-grade. Fresh from review._

### Generation

- ✅ 5 letter types (offer, raise, promo, bonus, total comp)
- ✅ AI-generated structured content
- ✅ Tenant-branded template (logo, color, signature)
- ✅ Rate limiting on generate
- ✅ XSS-safe rendering
- ✅ Signature/sender configurable in UI
- 🟡 Multi-language generation (prompt wired, needs eval)
- 🟡 Tone presets (shipped) + per-tenant default (default missing)
- ⬜ Variable substitution preview before generation
- ⬜ Custom template upload (per tenant)
- ⬜ Template library (10+ industry-standard variations)

### Workflow

- ✅ Status state machine (DRAFT → GENERATING → REVIEW → APPROVED → SENT → FAILED)
- ✅ Approval flow — configurable chain (any depth), per-step comments, role-gated, author cannot self-approve
- 🟡 Reviewer comments / track changes (per-step approval comments; no track-changes yet)
- ⬜ Version history (every edit is a snapshot)
- ⬜ Compare versions side-by-side

### Batch

- ✅ Batch generate up to 100
- ✅ Concurrency cap
- ✅ Background job (BullMQ) instead of inline
- ✅ Batch progress UI
- ✅ Partial-success handling
- ⬜ Per-tenant daily generation cap

### Delivery

- ⬜ E-signature integration (DocuSign / native)
- 🟡 Email delivery (SMTP via nodemailer; open / click tracking pending)
- ⬜ SMS notification (optional)
- ⬜ Manager + employee notification
- ✅ Acknowledgement capture (HMAC-signed link, idempotent confirmation page)
- ⬜ Decline path

### Output

- ✅ PDF render (Puppeteer + pdfkit fallback)
- ⬜ DOCX export
- ⬜ Print-friendly view
- ⬜ Mail merge to letterhead

### Compliance

- ⬜ Required-disclaimer per jurisdiction
- ⬜ Pay transparency note (CA/CO/NY)
- ⬜ Retention policy (auto-purge after N years)

**Bar to ship:** Bar 6 (Tier B) · **Estimated effort:** 2 weeks (mostly done)

---

## 6. Job Architecture

_Anchor: Workday / HRSoft._

- ⬜ Job families (taxonomy)
- ⬜ Job levels (career ladder per family)
- ⬜ Job profiles (description, competencies, qualifications)
- ⬜ Job-to-band mapping
- ⬜ Career path visualization (lateral + vertical moves)
- ⬜ Skills + competency framework
- ⬜ Promotion criteria per level
- ⬜ AI-suggested job mapping for new hires
- ⬜ Bulk re-leveling tool
- ⬜ Audit trail on level changes
- ⬜ Bilingual job descriptions
- ⬜ Export to job-board ATS

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 2 weeks

---

## 7. Benefits

_Anchor: Workday / Bswift. 7 categories already scaffolded._

### Plan management (per category)

- ⬜ Health (medical, dental, vision)
- ⬜ Retirement (401k, pension, NPS, EPF)
- ⬜ Wellness (gym, mental health, EAP)
- ⬜ Recognition (awards, spot bonuses)
- ⬜ Flex (FSA, HSA, commuter, custom wallets)
- ⬜ Leave (PTO, parental, sabbatical, bereavement)
- ⬜ Perks (meal, learning, equipment)

### Per-plan capabilities

- ⬜ Plan setup (provider, tiers, costs)
- ⬜ Eligibility rules
- ⬜ Cost share (employer/employee)
- ⬜ Total cost-to-employer rollup
- ⬜ Documents (SBC, plan docs)

### Employee experience

- ⬜ Enrollment window UI
- ⬜ Plan comparison tool
- ⬜ Dependent management
- ⬜ Beneficiary management
- ⬜ Life event flow (marriage, birth, divorce, move)
- ⬜ Confirmation statement
- ⬜ Year-round changes (qualifying events)

### Admin

- ⬜ Open enrollment workflow
- ⬜ Mid-year amendments
- ⬜ Carrier file generation (834 / EDI)
- ⬜ Reconciliation against payroll deductions
- ⬜ Vendor SSO

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 6+ weeks (large surface)

---

## 8. Equity

_Anchor: Carta. Highly regulated, table-stakes for tech companies._

### Plans

- ⬜ Plan management (RSU / ISO / NSO / ESPP / SAR / Phantom)
- ⬜ Plan documents
- ⬜ Pool tracking (issued, exercised, available)
- ⬜ Authorization tracking (board-approved pool)

### Grants

- 🟡 Grant creation
- ⬜ Vesting schedules (cliff + monthly / anniversary / quarterly / accelerated)
- ⬜ Performance-based vesting
- ⬜ Stock split handling
- ⬜ Forfeiture on termination
- ⬜ Grant amendment audit trail
- ⬜ Bulk grant import

### Employee view

- ⬜ Vested / unvested / total
- ⬜ Vesting timeline visual
- ⬜ Estimated value at current 409A
- ⬜ Tax impact (US / IN / UK / EU / SG)
- ⬜ Exercise simulator
- ⬜ Sale proceeds calculator

### Admin

- ⬜ 409A valuation tracking
- ⬜ Grant approval workflow
- ⬜ Termination workflow (vest cutoff, exercise window)
- ⬜ Exercise + sale recording
- ⬜ Cap table snapshot (read-only)

### Compliance

- ⬜ ASC 718 expense calc
- ⬜ Disclosure reports
- ⬜ Audit-ready exports

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 6+ weeks

---

## 9. Reports

_Anchor: Looker / Tableau lite._

### Library

- ⬜ Pre-built report catalog (20+ standard comp reports)
- ⬜ Search + categorize
- ⬜ Favorites / pinning
- ⬜ Recently run

### Builder

- ⬜ Drag-drop column chooser
- ⬜ Filter builder (AND/OR groups)
- ⬜ Aggregations (sum, avg, count, percentile)
- ⬜ Group by + pivot
- ⬜ Calculated fields
- ⬜ Sort + limit
- ⬜ Save with name + description
- ⬜ Share with team / make public

### Visualizations

- ⬜ Tables (with column resize, sort, freeze)
- ⬜ Charts (bar, line, pie, scatter, heatmap)
- ⬜ Drill-down on click
- ⬜ Cross-filter

### Delivery

- ⬜ Export (XLSX, CSV, PDF)
- ⬜ Scheduled delivery (daily/weekly/monthly to email)
- ⬜ Slack delivery
- ⬜ Embed in dashboard

### AI

- ⬜ Natural language → report ("show me all engineers > $200K")
- ⬜ Suggested reports based on role
- ⬜ Auto-narrative summary

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 4 weeks

---

## 10. Attrition

_Anchor: Visier / Eightfold._

### Risk scoring

- 🟡 Per-employee attrition probability score
- ⬜ Top drivers per employee (comp gap, no promo, manager change)
- ⬜ Confidence interval
- ⬜ Score history (track over quarters)
- ⬜ Cohort risk distribution

### Insights

- ⬜ Manager view ("my team's risk")
- ⬜ Org-level risk heatmap
- ⬜ Comp gap → attrition correlation
- ⬜ Tenure-band attrition
- ⬜ Cost-of-attrition by role / level

### Action

- ⬜ Retention recommendation (raise / promo / 1:1)
- ⬜ Bulk export ranked at-risk list
- ⬜ Slack/email alert on high-risk new entrants
- ⬜ Trigger ad-hoc cycle for retention

### Model

- ⬜ Model retraining cadence
- ⬜ Per-tenant model option
- ⬜ Feature importance shown
- ⬜ Drift monitoring

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 3–4 weeks

---

## 11. Compliance

_Anchor: Trusaic / OneTrust._

### Policy library

- ⬜ Pre-loaded policies (FLSA, EEO, GDPR, EU Pay Transparency, NYC/CA pay transparency)
- ⬜ Custom policy upload (PDF/markdown)
- ⬜ Policy versioning

### Scanning

- 🟡 AI compliance scanner
- ⬜ Scheduled scans
- ⬜ Findings by severity (critical / high / medium / low)
- ⬜ Findings dashboard
- ⬜ False-positive marking with reason

### Remediation

- ⬜ Per-finding remediation workflow
- ⬜ Owner assignment
- ⬜ Due date + escalation
- ⬜ Closure with evidence

### Reporting

- ⬜ Statutory report templates
- ⬜ Audit export (immutable, signed)
- ⬜ Quarterly compliance summary

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 3 weeks

---

## 12. Rules Engine

_Anchor: HRSoft policy-as-code, no clear consumer leader._

### Authoring

- 🟡 Natural language → rule
- ⬜ Visual rule builder (no-code)
- ⬜ Rule library / templates
- ⬜ Rule composition (chain merit + cap + floor)
- ⬜ Conditional rules (if-then-else)
- ⬜ Priority / order of evaluation

### Lifecycle

- ⬜ Rule versioning + diff
- ⬜ Draft / publish / retire states
- ⬜ Approval workflow on publish
- ⬜ Lineage (who changed, when, why)

### Testing

- ⬜ Test cases per rule
- ⬜ Run against sample data
- ⬜ Run against historical full data (regression)
- ⬜ Coverage report (which rules fire on which rows)

### Simulation

- ⬜ What-if simulation against current population
- ⬜ Compare two rule sets side-by-side
- ⬜ Cost impact projection

### Execution

- ⬜ Apply rules in cycle
- ⬜ Per-row trace (which rules fired, with values)
- ⬜ Override + justification

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 4 weeks

---

## 13. Payroll

_Anchor: ADP / Workday Payroll. Limited scope — we're augmentation, not full payroll._

### Runs

- 🟡 Payroll run preview
- ⬜ Run state machine (DRAFT → CALCULATED → APPROVED → PROCESSED → POSTED)
- ⬜ Multi-step approval
- ⬜ Per-employee line items
- ⬜ Variance vs prior run

### Anomalies

- 🟡 Anomaly detection
- 🟡 AI explainer per anomaly
- ⬜ Severity ranking
- ⬜ Bulk acknowledge / resolve
- ⬜ Auto-create JIRA / Linear ticket

### Reconciliation

- 🟡 GL reconciliation
- ⬜ Bank file reconciliation
- ⬜ Variance dashboard
- ⬜ Unreconciled queue

### Integration

- ⬜ Export to ADP / Workday Payroll / Gusto / Razorpay / Darwinbox
- ⬜ Pay slip generation (per jurisdiction)
- ⬜ Tax filing handoff
- ⬜ Pension / EPF file generation

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 4 weeks

---

## 14. Benchmarking

_Anchor: Mercer / Radford / Pave._

### Data sources

- 🟡 Connect external surveys (Mercer, Aon, Radford)
- ⬜ Custom internal benchmarks
- ⬜ Crowd-sourced data (anonymized aggregate from other tenants — opt-in)
- ⬜ Data freshness indicator + aging factor

### Position matching

- ⬜ AI-assisted job → benchmark mapping
- ⬜ Manual override
- ⬜ Confidence score per match
- ⬜ Bulk match for new survey

### Analysis

- ⬜ Percentile lookup (P10, P25, P50, P75, P90)
- ⬜ Geo / industry / size filters
- ⬜ Compa-ratio per employee against market
- ⬜ Lag/lead identification
- ⬜ Aging adjustment

### Output

- ⬜ Salary band recommendation
- ⬜ Per-role market sheet
- ⬜ Mid-cycle market refresh

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 3 weeks

---

## 15. Ad-hoc Increases

_Anchor: Workday off-cycle._

- 🟡 Initiate request
- ⬜ Effective date
- ⬜ Justification with templates
- ⬜ Budget impact preview
- ⬜ Conflict check (already in active cycle?)
- ⬜ Multi-step approval
- ⬜ Auto-policy check (within band? requires extra approver)
- ⬜ Letter generation on approval (link to Letters)
- ⬜ Writeback to source-of-truth
- ⬜ Status tracking + audit
- ⬜ Bulk import (CSV)
- ⬜ Reporting on ad-hoc volume / spend

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 2 weeks

---

## 16. Data Import & Hygiene

_Anchor: Workato / native HRIS importers._

### Import

- 🟡 CSV / XLSX upload
- ⬜ Drag-drop UI with preview
- ⬜ AI-assisted column mapping (suggest based on header)
- ⬜ Save mapping as template
- ⬜ Template library
- ⬜ Scheduled imports (SFTP / S3)
- ⬜ Incremental import (only changed rows)

### Validation

- 🟡 Issue detection (duplicates, missing required, out of range)
- ⬜ Per-rule severity
- ⬜ Bulk fix UI
- ⬜ Per-row error context

### History

- 🟡 Import history
- ⬜ Diff per import (what changed)
- ⬜ Rollback (revert an import)
- ⬜ Import comparison

### Quality monitoring

- ⬜ Data-quality score per tenant
- ⬜ Issues dashboard
- ⬜ Auto-detect drift / new fields
- ⬜ Trending quality over time

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 3 weeks

---

## 17. Integrations

_Anchor: Workato / Merge.dev._

### Connectors

- ⬜ Pre-built: Workday, BambooHR, HiBob, Rippling, Gusto, ADP, SAP SF, Darwinbox, Razorpay, Greenhouse, Lever, Slack, MS Teams, Okta, Azure AD
- ⬜ OAuth / API key flows
- ⬜ Connection health monitoring
- ⬜ Per-connector docs

### Field mapping

- 🟡 AI-suggested mapping
- ⬜ Manual override
- ⬜ Transformations (split, concat, lookup, conditional)
- ⬜ Test mapping against sample
- ⬜ Save mapping as version

### Sync

- 🟡 Sync engine
- ⬜ Real-time vs scheduled
- ⬜ Bidirectional vs one-way
- ⬜ Sync status dashboard
- ⬜ Per-entity selective sync
- ⬜ Pause/resume per integration
- ⬜ Conflict resolution rules

### Webhooks

- 🟡 Webhook endpoint registration
- ⬜ Signature verification
- ⬜ Replay / retry
- ⬜ Webhook log + filter

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 6+ weeks (large surface)

---

## 18. Compport Bridge

_Proprietary — read/write between CompportIQ and the Compport PHP product._

- 🟡 Read from Compport schema (employees, roles, pages, permissions)
- 🟡 Schema discovery (which tables exist)
- 🟡 Per-tenant schema isolation
- ⬜ Writeback batches (push approved comp changes)
- ⬜ Conflict detection (changed in both systems)
- ⬜ Conflict resolution UI
- ⬜ Sync health dashboard
- ⬜ Per-tenant pause/resume
- ⬜ Backfill jobs
- ⬜ Diff viewer (CompportIQ vs Compport)
- ⬜ Reconciliation report
- ⬜ Failed write retry with exponential backoff
- ⬜ Audit log of every write

**Bar to ship:** Bar 6 (Tier A — strategic) · **Estimated effort:** 4 weeks

---

## 19. Notifications & Nudges

_Anchor: Lattice / Microsoft Viva._

### Channels

- 🟡 In-app notifications
- ⬜ Email
- ⬜ Slack
- ⬜ MS Teams
- ⬜ SMS (optional)

### User control

- ⬜ Per-channel preferences
- ⬜ Per-event preferences
- ⬜ Quiet hours (timezone-aware)
- ⬜ Digest mode (daily/weekly summary)

### Nudge engine

- ⬜ Behavioral prompts ("3 raises pending review")
- ⬜ Smart timing (don't nudge during quiet hours)
- ⬜ Per-tenant nudge rules
- ⬜ A/B test nudges
- ⬜ Nudge effectiveness metrics

### Admin

- ⬜ Notification template library
- ⬜ Per-tenant template override
- ⬜ Notification log per user

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 3 weeks

---

## 20. Settings & Tenant Admin

_Anchor: Workday tenant admin._

### Tenant

- 🟡 Tenant profile (name, logo, color)
- ⬜ Custom domain config
- ⬜ Branding preview
- ⬜ Currency preferences
- ⬜ Locale + timezone defaults
- ⬜ Letter signature config (just added; needs UI)
- ⬜ Email templates customization

### Users + roles

- 🟡 User management
- ⬜ Role management
- 🟡 Permission matrix
- ⬜ Bulk invite
- ⬜ User deactivation flow
- ⬜ Last-login + audit

### Auth

- 🟡 SSO config (Azure AD)
- ⬜ Google Workspace SSO
- ⬜ Okta SSO
- ⬜ SCIM provisioning
- ⬜ Password policy
- ⬜ MFA enforcement

### API + integrations

- ⬜ API key management
- ⬜ Webhook subscriptions
- ⬜ Rate-limit visibility

### Audit

- 🟡 Audit log viewer
- ⬜ Filter by user / action / entity
- ⬜ Export audit log

**Bar to ship:** Bar 5 (Tier B) · **Estimated effort:** 3 weeks

---

## 21. Platform Admin (internal)

_Internal — for you and your team._

### Customer fleet

- 🟡 Customer list
- 🟡 Per-customer overview
- ⬜ Health score per customer
- ⬜ Last-activity per customer
- ⬜ NPS / feedback capture

### Onboarding

- 🟡 Onboarding wizard
- ⬜ Onboarding checklist with progress
- ⬜ Self-serve onboarding for small customers

### Operations

- 🟡 Sync status fleet view
- 🟡 Stats dashboard
- ⬜ Per-tenant cost dashboard (LLM, infra, storage)
- ⬜ Per-tenant feature flag toggles
- ⬜ Per-tenant LLM model selection
- 🟡 Suspend / activate
- ⬜ Customer impersonation (with audit)

### Diagnostics

- 🟡 Data audit per tenant
- 🟡 Test connection
- ⬜ Replay-failed-job UI
- ⬜ Tenant-scoped log viewer

**Bar to ship:** Bar 5 · **Estimated effort:** 2 weeks

---

## 22. Auth & Security

_Anchor: Okta / Workday._

- ✅ JWT + refresh tokens
- ✅ Token blacklist
- ✅ CSRF protection
- ✅ Helmet security headers
- ✅ Rate limiting (per-endpoint)
- ✅ RLS extension on Prisma
- ✅ PII encryption middleware
- 🟡 Azure AD SSO
- ⬜ Google / Okta SSO
- ⬜ SCIM provisioning
- ⬜ Per-tenant MFA enforcement
- ⬜ IP allowlist per tenant
- ⬜ Session management (active sessions, revoke remote)
- ⬜ Password policy enforcement
- ⬜ Brute-force lockout + recovery
- ⬜ Security event log (failed logins, perm changes)
- ⬜ Penetration test report
- ⬜ SOC 2 readiness pack
- ⬜ Data residency option (US / EU / IN)
- ⬜ Customer-managed encryption keys (BYOK)

**Bar to ship:** Bar 6 (always Tier A — security gates everything) · **Estimated effort:** 4 weeks

---

## How to use this document

1. **Today** — read top to bottom and tell me which features are wrong-tiered, missing capabilities, or have ones I marked as ⬜ that are actually ✅
2. **Next** — for each feature, run the engineering audit (the checklist from v1) to confirm current bar
3. **Then** — pick the order to work in. My recommendation: Letters → Comp Cycles → Copilot → Pay Equity → Compport Bridge (the Tier A 5)
4. **Always** — when shipping a capability, tick it ✅ here and link the PR

**Engineering safety rails** (still required, but folded into per-feature work, not a separate phase):

- Every new module rewrite ships behind a per-tenant feature flag
- Every Tier-A module needs e2e smoke tests before going GA
- Every PR has structured logging on new endpoints
- Every PR runs against the demo tenant before production

---

## Changelog

- 2026-04-27 v2 — Restructured around feature capability checklists
- 2026-04-27 v1 — Engineering hardening framework (now folded into "safety rails")
