/**
 * Phase 3 — Report renderers.
 *
 * Pure functions that turn a stored PayEquityRun envelope into a downloadable
 * artifact (CSV string or PDF-ready HTML). The PayEquityV2Service is the only
 * caller and handles Puppeteer for PDF formats.
 *
 * The statutory exports (EU PTD, UK GPG, EEO-1, CA SB 1162) deliberately fill
 * what we have from the regression envelope and explicitly mark fields that
 * need raw employee data (e.g. bonus pay gap, hourly rate quartiles) as
 * `not_available` rather than blank — that signals "needs additional data
 * source" to the consumer instead of looking like an empty cell. The bible's
 * Phase 3 risk row notes these need a comp lawyer review pass before we ship
 * to customers; the export pipeline is the load-bearing piece here.
 */
import { createHash } from 'node:crypto';
import type { PayEquityAgentResult } from '@compensation/ai';
import type { PayEquityReport } from '../analytics/pay-equity.service';

export type ReportType =
  | 'board'
  | 'eu_ptd'
  | 'uk_gpg'
  | 'eeo1'
  | 'sb1162'
  | 'auditor'
  | 'defensibility'
  | 'comp_committee_deck'
  | 'employee_statement';

export const REPORT_TYPES: ReportType[] = [
  'board',
  'eu_ptd',
  'uk_gpg',
  'eeo1',
  'sb1162',
  'auditor',
  'defensibility',
  'comp_committee_deck',
  'employee_statement',
];

export type RenderOutput =
  | { format: 'csv'; filename: string; mimeType: 'text/csv'; content: string }
  | { format: 'pdf-html'; filename: string; mimeType: 'application/pdf'; html: string };

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string | null;
  changes: unknown;
  createdAt: Date;
}

export interface ChildAgentRun {
  runId: string;
  agentType: string;
  status: string;
  summary: string | null;
  createdAt: Date;
}

export interface RenderContext {
  runId: string;
  runAt: Date;
  tenantId: string;
  tenantName: string;
  envelope: PayEquityAgentResult<PayEquityReport>;
  /** Phase 5 — populated only for the defensibility renderer. */
  auditTrail?: AuditEvent[];
  childRuns?: ChildAgentRun[];
  /** Phase 6.1 — populated only for the employee_statement renderer. */
  employee?: {
    employeeId: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    level: string;
    department: string;
    compaRatio: number | null;
    baseSalary: number;
    currency: string;
  };
}

const NA = 'not_available';

/* ─── CSV helpers ───────────────────────────────────────────── */

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

function pct(n: number): string {
  return `${(Math.round(n * 100) / 100).toFixed(2)}%`;
}

function pctRaw(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ─── Anonymization ─────────────────────────────────────────── */

/**
 * Tenant-scoped one-way hash: same tenant + same id → same hash, different
 * tenant produces a different hash so the auditor can't cross-correlate.
 */
function hashId(tenantId: string, id: string): string {
  return createHash('sha256').update(`${tenantId}:${id}`).digest('hex').slice(0, 12);
}

/* ─── HTML helpers ──────────────────────────────────────────── */

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pdfShell(opts: { title: string; bodyHtml: string; watermark?: string }): string {
  const watermark = opts.watermark
    ? `<div style="position:fixed;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:80px;color:rgba(0,0,0,.06);font-weight:800;letter-spacing:8px;pointer-events:none;z-index:0">${htmlEscape(
        opts.watermark,
      )}</div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${htmlEscape(
    opts.title,
  )}</title><style>
    *{box-sizing:border-box}
    body{margin:0;padding:48px 56px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;background:#fff}
    h1{font-size:28px;margin:0 0 4px;letter-spacing:-.02em}
    h2{font-size:18px;margin:32px 0 8px;letter-spacing:-.01em;border-bottom:1px solid #e2e8f0;padding-bottom:6px}
    h3{font-size:14px;margin:20px 0 8px;color:#334155}
    p{margin:0 0 10px}
    .meta{color:#64748b;font-size:12px;margin-bottom:24px}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
    .card{border:1px solid #e2e8f0;border-radius:6px;padding:12px}
    .card .label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
    .card .value{font-size:22px;font-weight:600;margin-top:4px}
    table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0}
    th{background:#f8fafc;text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#334155}
    td{padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
    .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600}
    .badge-high{background:#fee2e2;color:#991b1b}
    .badge-medium{background:#fef3c7;color:#92400e}
    .badge-low{background:#dcfce7;color:#166534}
    .methodology{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;margin-top:24px;font-size:12px;color:#334155}
    .footer{margin-top:48px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b}
  </style></head><body>${watermark}<div style="position:relative;z-index:1">${opts.bodyHtml}</div></body></html>`;
}

function severityBadge(level: 'HIGH' | 'MEDIUM' | 'LOW' | string): string {
  const cls = level === 'HIGH' ? 'badge-high' : level === 'MEDIUM' ? 'badge-medium' : 'badge-low';
  return `<span class="badge ${cls}">${htmlEscape(level)}</span>`;
}

/* ─── Renderers ─────────────────────────────────────────────── */

function renderBoardPdf(ctx: RenderContext): RenderOutput {
  const { envelope, tenantName, runAt, runId } = ctx;
  const r = envelope.output;
  const sigGaps = r.regressionResults.filter((x) => x.significance === 'significant');
  const worst = r.regressionResults
    .slice()
    .sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent))[0];

  const dimsCount =
    r.dimensions?.length ?? new Set(r.regressionResults.map((x) => x.dimension)).size;
  const cards = [
    { label: 'Sample size', value: (r.overallStats?.totalEmployees ?? 0).toLocaleString() },
    { label: 'Significant gaps', value: String(sigGaps.length) },
    {
      label: 'Worst gap',
      value: worst ? pct(worst.gapPercent) : '—',
    },
    { label: 'R²', value: (r.overallStats?.rSquared ?? 0).toFixed(3) },
  ];

  const cardsHtml = cards
    .map(
      (c) =>
        `<div class="card"><div class="label">${htmlEscape(c.label)}</div><div class="value">${htmlEscape(
          c.value,
        )}</div></div>`,
    )
    .join('');

  const cohortRows = r.regressionResults
    .map(
      (x) =>
        `<tr><td>${htmlEscape(x.dimension)}/${htmlEscape(x.group)} <span style="color:#94a3b8">vs ${htmlEscape(
          x.referenceGroup,
        )}</span></td><td>${pct(x.gapPercent)}</td><td>p=${x.pValue.toFixed(
          3,
        )}</td><td>${x.sampleSize}</td><td>${severityBadge(x.riskLevel)}</td></tr>`,
    )
    .join('');

  const warningsHtml = envelope.warnings.length
    ? `<h3>Data quality warnings</h3><ul>${envelope.warnings
        .map((w) => `<li><b>${htmlEscape(w.code)}:</b> ${htmlEscape(w.message)}</li>`)
        .join('')}</ul>`
    : '';

  const headline = sigGaps.length
    ? `${sigGaps.length} statistically-significant pay gap${sigGaps.length === 1 ? '' : 's'} identified across ${dimsCount} dimension${dimsCount === 1 ? '' : 's'}.`
    : `No statistically-significant pay gaps identified across ${dimsCount} dimension${dimsCount === 1 ? '' : 's'}.`;

  const body = `
    <h1>${htmlEscape(tenantName)} — Pay Equity Report</h1>
    <div class="meta">Run ${htmlEscape(runId)} · Generated ${isoDate(runAt)} · Methodology ${htmlEscape(envelope.methodology.name)}@${htmlEscape(envelope.methodology.version)} · Confidence ${htmlEscape(envelope.confidence)}</div>

    <h2>Executive summary</h2>
    <p>${htmlEscape(headline)}</p>

    <div class="grid">${cardsHtml}</div>

    <h2>Cohort findings</h2>
    <table><thead><tr><th>Cohort</th><th>Gap</th><th>p-value</th><th>n</th><th>Risk</th></tr></thead><tbody>${cohortRows}</tbody></table>

    ${warningsHtml}

    <h2>Remediation snapshot</h2>
    <p>Estimated cost-to-close: <b>${(r.remediation?.totalCost ?? 0).toLocaleString()}</b> across <b>${r.remediation?.affectedEmployees ?? 0}</b> employees (avg adjustment ${(r.remediation?.avgAdjustment ?? 0).toLocaleString()}).</p>

    <div class="methodology">
      <b>Methodology</b><br/>
      Model: ${htmlEscape(envelope.methodology.name)}@${htmlEscape(envelope.methodology.version)} · OLS regression of log(baseSalary) on protected class indicator + controls.<br/>
      Controls: ${envelope.methodology.controls.map(htmlEscape).join(', ')}<br/>
      Sample size: ${envelope.methodology.sampleSize.toLocaleString()} · Confidence interval: ${(envelope.methodology.confidenceInterval * 100).toFixed(0)}%<br/>
      Citations: ${envelope.citations.length} regression coefficients backing the findings above.
    </div>

    <div class="footer">Audit trail: PayEquityRun id=${htmlEscape(runId)}. This report is generated from the immutable envelope persisted at run time. Bumping methodology version creates a new run; this report is a frozen snapshot.</div>
  `;

  return {
    format: 'pdf-html',
    filename: `pay-equity-board-${isoDate(runAt)}.pdf`,
    mimeType: 'application/pdf',
    html: pdfShell({ title: 'Pay Equity Board Report', bodyHtml: body }),
  };
}

function renderAuditorPdf(ctx: RenderContext): RenderOutput {
  const { envelope, tenantId, runAt, runId } = ctx;
  const r = envelope.output;

  const cohortRows = r.regressionResults
    .map(
      (x) =>
        `<tr><td>${htmlEscape(x.dimension)}/${htmlEscape(x.group)}</td><td>${x.coefficient.toFixed(
          4,
        )}</td><td>${x.standardError.toFixed(4)}</td><td>${x.tStatistic.toFixed(2)}</td><td>${x.pValue.toFixed(
          4,
        )}</td><td>[${x.confidenceInterval[0].toFixed(3)}, ${x.confidenceInterval[1].toFixed(
          3,
        )}]</td><td>${x.sampleSize}</td><td>${pct(x.gapPercent)}</td><td>${x.significance}</td></tr>`,
    )
    .join('');

  const citationRows = envelope.citations
    .slice(0, 100)
    .map(
      (c, i) =>
        `<tr><td>${i + 1}</td><td>${htmlEscape(c.type)}</td><td>${htmlEscape(c.ref)}</td><td>${htmlEscape(c.excerpt ?? '')}</td></tr>`,
    )
    .join('');

  const tenantHash = hashId(tenantId, tenantId);

  const body = `
    <h1>Pay Equity — Auditor Defensibility Export</h1>
    <div class="meta">Tenant ${htmlEscape(tenantHash)} (hashed) · Run ${htmlEscape(runId)} · Generated ${runAt.toISOString()}</div>

    <h2>Methodology</h2>
    <table>
      <tr><th>Field</th><th>Value</th></tr>
      <tr><td>Model</td><td>${htmlEscape(envelope.methodology.name)}@${htmlEscape(envelope.methodology.version)}</td></tr>
      <tr><td>Dependent variable</td><td>${htmlEscape(envelope.methodology.dependentVariable ?? 'log_salary')}</td></tr>
      <tr><td>Controls</td><td>${envelope.methodology.controls.map(htmlEscape).join(', ')}</td></tr>
      <tr><td>Sample size</td><td>${envelope.methodology.sampleSize}</td></tr>
      <tr><td>Confidence interval</td><td>${(envelope.methodology.confidenceInterval * 100).toFixed(0)}%</td></tr>
      <tr><td>Compliance threshold</td><td>${envelope.methodology.complianceThreshold ?? '—'}%</td></tr>
      <tr><td>Confidence level</td><td>${htmlEscape(envelope.confidence)}</td></tr>
    </table>

    <h2>Regression results</h2>
    <table><thead><tr><th>Cohort</th><th>β</th><th>SE</th><th>t</th><th>p</th><th>95% CI</th><th>n</th><th>gap %</th><th>significance</th></tr></thead><tbody>${cohortRows}</tbody></table>

    <h2>Citations (${envelope.citations.length} total)</h2>
    <table><thead><tr><th>#</th><th>type</th><th>ref</th><th>excerpt</th></tr></thead><tbody>${citationRows}</tbody></table>

    ${
      envelope.warnings.length
        ? `<h2>Warnings</h2><ul>${envelope.warnings.map((w) => `<li><b>${htmlEscape(w.code)}:</b> ${htmlEscape(w.message)}</li>`).join('')}</ul>`
        : ''
    }

    <div class="footer">All identifiers in this export are hashed (sha256, tenant-scoped, 12 hex chars). The underlying PayEquityRun row is immutable; this artifact is reproducible from the same runId. Audit trail action: PAY_EQUITY_REPORT_EXPORTED.</div>
  `;

  return {
    format: 'pdf-html',
    filename: `pay-equity-auditor-${isoDate(runAt)}.pdf`,
    mimeType: 'application/pdf',
    html: pdfShell({
      title: 'Pay Equity Auditor Export',
      bodyHtml: body,
      watermark: 'AUDITOR EXPORT',
    }),
  };
}

/**
 * EU Pay Transparency Directive (Directive (EU) 2023/970) — first-pass export.
 *
 * Statutory categories required (per Article 9):
 *  - Pay gap (mean / median) overall
 *  - Pay gap by category of workers (we map to dimension/group)
 *  - Bonus pay gap + share receiving bonus  → `not_available` until we wire CompComponent breakdown
 *  - Pay quartile breakdown by sex          → `not_available` until we have raw employee access
 *
 * Output: a single CSV with a metadata header block, then one row per cohort.
 */
function renderEuPtdCsv(ctx: RenderContext): RenderOutput {
  const { envelope, tenantName, runAt, runId } = ctx;
  const r = envelope.output;

  const meta: Array<Array<string | number>> = [
    ['# EU Pay Transparency Directive — Article 9 disclosure'],
    ['# Directive (EU) 2023/970'],
    [`# Tenant`, tenantName],
    [`# Run id`, runId],
    [`# Reporting period (generated)`, isoDate(runAt)],
    [`# Methodology`, `${envelope.methodology.name}@${envelope.methodology.version}`],
    [`# Total employees`, r.overallStats.totalEmployees],
    [
      `# Bonus & quartile breakdowns`,
      'not_available — requires CompComponent + raw employee dataset (see Phase 3.2 follow-up)',
    ],
    [],
  ];

  const header = [
    'category_of_workers',
    'protected_class_dimension',
    'protected_class_group',
    'reference_group',
    'sample_size',
    'mean_pay_gap_percent',
    'median_pay_gap_percent',
    'bonus_pay_gap_percent',
    'share_receiving_bonus_percent',
    'p_value',
    'significance',
    'risk_level',
  ];

  const rows: Array<Array<string | number>> = r.regressionResults.map((x) => [
    'all_workers',
    x.dimension,
    x.group,
    x.referenceGroup,
    x.sampleSize,
    pctRaw(x.gapPercent),
    NA,
    NA,
    NA,
    x.pValue,
    x.significance,
    x.riskLevel,
  ]);

  const csv = toCsv([...meta, header, ...rows]);
  return {
    format: 'csv',
    filename: `pay-equity-eu-ptd-${isoDate(runAt)}.csv`,
    mimeType: 'text/csv',
    content: csv,
  };
}

/**
 * UK Gender Pay Gap (Equality Act 2010 (Gender Pay Gap Information) Regulations 2017).
 *
 * Six required figures:
 *  1. Mean gender pay gap (hourly rate)
 *  2. Median gender pay gap (hourly rate)
 *  3. Mean bonus gender pay gap
 *  4. Median bonus gender pay gap
 *  5. Proportion of male/female receiving bonus
 *  6. Proportion of male/female in each pay quartile
 *
 * For Phase 3 first cut we emit (1) computed from regression coefficient on
 * gender, (2) we don't have median without raw data (mark NA), (3-6) NA.
 */
function renderUkGpgCsv(ctx: RenderContext): RenderOutput {
  const { envelope, tenantName, runAt, runId } = ctx;
  const r = envelope.output;

  const genderRow = r.regressionResults.find(
    (x) => x.dimension === 'gender' && /female|f/i.test(x.group),
  );

  const meanGap = genderRow ? pctRaw(genderRow.gapPercent) : NA;

  const meta: Array<Array<string | number>> = [
    ['# UK Gender Pay Gap (Equality Act 2010, 2017 Regulations)'],
    [`# Tenant`, tenantName],
    [`# Run id`, runId],
    [`# Snapshot date`, isoDate(runAt)],
    [`# Methodology`, `${envelope.methodology.name}@${envelope.methodology.version}`],
    [`# Total employees`, r.overallStats.totalEmployees],
    [
      `# Median + bonus + quartile figures`,
      'not_available — requires hourly-rate + bonus + raw employee dataset',
    ],
    [],
  ];

  const rows: Array<Array<string | number>> = [
    ['figure', 'value', 'notes'],
    ['mean_gender_pay_gap_percent', meanGap, 'derived from regression coefficient on gender'],
    ['median_gender_pay_gap_percent', NA, 'requires raw hourly-rate dataset'],
    ['mean_bonus_pay_gap_percent', NA, 'requires CompComponent.bonus breakdown'],
    ['median_bonus_pay_gap_percent', NA, 'requires CompComponent.bonus breakdown'],
    ['proportion_male_receiving_bonus_percent', NA, 'requires CompComponent.bonus breakdown'],
    ['proportion_female_receiving_bonus_percent', NA, 'requires CompComponent.bonus breakdown'],
    ['quartile_lower_male_percent', NA, 'requires raw hourly-rate dataset'],
    ['quartile_lower_female_percent', NA, 'requires raw hourly-rate dataset'],
    ['quartile_lower_middle_male_percent', NA, ''],
    ['quartile_lower_middle_female_percent', NA, ''],
    ['quartile_upper_middle_male_percent', NA, ''],
    ['quartile_upper_middle_female_percent', NA, ''],
    ['quartile_upper_male_percent', NA, ''],
    ['quartile_upper_female_percent', NA, ''],
  ];

  return {
    format: 'csv',
    filename: `pay-equity-uk-gpg-${isoDate(runAt)}.csv`,
    mimeType: 'text/csv',
    content: toCsv([...meta, ...rows]),
  };
}

/**
 * EEO-1 Component 1 — federal contractor disclosure.
 *
 * Real EEO-1 is a 10 (job category) × 14 (race × sex) cell grid with
 * establishment-level rows. We don't have race/ethnicity in the basic gender
 * envelope. For Phase 3 first cut we emit one row per dimension/group with the
 * EEO category column blank (filled when canonical schema gains job-category
 * mapping).
 */
function renderEeo1Csv(ctx: RenderContext): RenderOutput {
  const { envelope, tenantName, runAt, runId } = ctx;
  const r = envelope.output;

  const meta: Array<Array<string | number>> = [
    ['# EEO-1 Component 1 — federal contractor disclosure'],
    ['# 29 CFR §1602.7'],
    [`# Tenant`, tenantName],
    [`# Run id`, runId],
    [`# Reporting period (generated)`, isoDate(runAt)],
    [`# Total employees`, r.overallStats.totalEmployees],
    [
      `# EEO job categories + race/ethnicity grid`,
      'not_available — requires canonical jobCategory mapping + race/ethnicity field',
    ],
    [],
  ];

  const header = [
    'eeo_job_category',
    'race_ethnicity',
    'sex',
    'cohort_dimension',
    'cohort_group',
    'employee_count',
    'gap_percent_vs_reference',
    'reference_group',
  ];

  const rows: Array<Array<string | number>> = r.regressionResults.map((x) => [
    NA,
    x.dimension === 'race' || x.dimension === 'ethnicity' ? x.group : NA,
    x.dimension === 'gender' ? x.group : NA,
    x.dimension,
    x.group,
    x.sampleSize,
    pctRaw(x.gapPercent),
    x.referenceGroup,
  ]);

  return {
    format: 'csv',
    filename: `pay-equity-eeo1-${isoDate(runAt)}.csv`,
    mimeType: 'text/csv',
    content: toCsv([...meta, header, ...rows]),
  };
}

/**
 * California SB 1162 (Labor Code §12999) Pay Data Report.
 *
 * Establishment-level rows by sex × race/ethnicity × job category × pay band,
 * with mean + median hourly rate per cell. Same data-availability story as
 * EEO-1 — we emit what we have plus explicit not_available markers.
 */
function renderSb1162Csv(ctx: RenderContext): RenderOutput {
  const { envelope, tenantName, runAt, runId } = ctx;
  const r = envelope.output;

  const meta: Array<Array<string | number>> = [
    ['# California Pay Data Report — SB 1162 / Labor Code §12999'],
    [`# Tenant`, tenantName],
    [`# Run id`, runId],
    [`# Reporting period (generated)`, isoDate(runAt)],
    [`# Total employees`, r.overallStats.totalEmployees],
    [
      `# Pay band breakdown + median/mean hourly rate per cell`,
      'not_available — requires hourly-rate dataset + canonical pay band mapping',
    ],
    [],
  ];

  const header = [
    'establishment_id',
    'eeo_job_category',
    'race_ethnicity',
    'sex',
    'pay_band',
    'employee_count',
    'mean_hourly_rate',
    'median_hourly_rate',
    'cohort_dimension',
    'cohort_group',
    'gap_percent_vs_reference',
  ];

  const rows: Array<Array<string | number>> = r.regressionResults.map((x) => [
    NA,
    NA,
    x.dimension === 'race' || x.dimension === 'ethnicity' ? x.group : NA,
    x.dimension === 'gender' ? x.group : NA,
    NA,
    x.sampleSize,
    NA,
    NA,
    x.dimension,
    x.group,
    pctRaw(x.gapPercent),
  ]);

  return {
    format: 'csv',
    filename: `pay-equity-sb1162-${isoDate(runAt)}.csv`,
    mimeType: 'text/csv',
    content: toCsv([...meta, header, ...rows]),
  };
}

/**
 * Phase 5 — Defensibility export.
 *
 * Comprehensive litigation-ready PDF: methodology, full regression detail,
 * citations, every audit event since the run was created, every child agent
 * invocation. Unlike the auditor export, this one is NOT anonymized — it's
 * an internal artifact prepared in case the analysis is challenged.
 *
 * Watermark: "DEFENSIBILITY EXPORT".
 */
function renderDefensibilityPdf(ctx: RenderContext): RenderOutput {
  const { envelope, tenantName, runAt, runId, auditTrail = [], childRuns = [] } = ctx;
  const r = envelope.output;

  const cohortRows = r.regressionResults
    .map(
      (x) =>
        `<tr><td>${htmlEscape(x.dimension)}/${htmlEscape(x.group)}</td><td>${htmlEscape(
          x.referenceGroup,
        )}</td><td>${x.coefficient.toFixed(4)}</td><td>${x.standardError.toFixed(
          4,
        )}</td><td>${x.tStatistic.toFixed(2)}</td><td>${x.pValue.toFixed(
          4,
        )}</td><td>[${x.confidenceInterval[0].toFixed(3)}, ${x.confidenceInterval[1].toFixed(
          3,
        )}]</td><td>${x.sampleSize}</td><td>${pct(x.gapPercent)}</td><td>${htmlEscape(
          x.significance,
        )}</td></tr>`,
    )
    .join('');

  const citationRows = envelope.citations
    .map(
      (c, i) =>
        `<tr><td>${i + 1}</td><td>${htmlEscape(c.type)}</td><td>${htmlEscape(c.ref)}</td><td>${htmlEscape(c.excerpt ?? '')}</td></tr>`,
    )
    .join('');

  const childRows = childRuns.length
    ? childRuns
        .map(
          (c) =>
            `<tr><td>${htmlEscape(c.agentType)}</td><td>${htmlEscape(c.runId)}</td><td>${htmlEscape(c.status)}</td><td>${htmlEscape(c.summary ?? '')}</td><td>${c.createdAt.toISOString()}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="5" style="color:#94a3b8">No child agent invocations recorded.</td></tr>`;

  const auditRows = auditTrail.length
    ? auditTrail
        .map((e) => {
          let changesText = '';
          try {
            changesText = JSON.stringify(e.changes ?? {});
          } catch {
            changesText = '[unserializable]';
          }
          if (changesText.length > 200) changesText = changesText.slice(0, 200) + '…';
          return `<tr><td>${e.createdAt.toISOString()}</td><td>${htmlEscape(e.action)}</td><td>${htmlEscape(e.entityType)}/${htmlEscape(e.entityId)}</td><td>${htmlEscape(e.userId ?? 'system')}</td><td><code style="font-size:10px">${htmlEscape(changesText)}</code></td></tr>`;
        })
        .join('')
    : `<tr><td colspan="5" style="color:#94a3b8">No audit events recorded.</td></tr>`;

  const body = `
    <h1>${htmlEscape(tenantName)} — Pay Equity Defensibility Export</h1>
    <div class="meta">Run ${htmlEscape(runId)} · Generated ${runAt.toISOString()} · Methodology ${htmlEscape(envelope.methodology.name)}@${htmlEscape(envelope.methodology.version)} · Confidence ${htmlEscape(envelope.confidence)} · ${envelope.citations.length} citations · ${auditTrail.length} audit events · ${childRuns.length} child agent invocations</div>

    <h2>Methodology</h2>
    <table>
      <tr><th>Field</th><th>Value</th></tr>
      <tr><td>Model</td><td>${htmlEscape(envelope.methodology.name)}@${htmlEscape(envelope.methodology.version)}</td></tr>
      <tr><td>Dependent variable</td><td>${htmlEscape(envelope.methodology.dependentVariable ?? 'log_salary')}</td></tr>
      <tr><td>Controls</td><td>${envelope.methodology.controls.map(htmlEscape).join(', ')}</td></tr>
      <tr><td>Sample size</td><td>${envelope.methodology.sampleSize}</td></tr>
      <tr><td>Confidence interval</td><td>${(envelope.methodology.confidenceInterval * 100).toFixed(0)}%</td></tr>
      <tr><td>Compliance threshold</td><td>${envelope.methodology.complianceThreshold ?? '—'}%</td></tr>
      <tr><td>Confidence level</td><td>${htmlEscape(envelope.confidence)}</td></tr>
    </table>

    <h2>Regression results (full detail)</h2>
    <table><thead><tr><th>Cohort</th><th>vs reference</th><th>β</th><th>SE</th><th>t</th><th>p</th><th>95% CI</th><th>n</th><th>gap %</th><th>significance</th></tr></thead><tbody>${cohortRows}</tbody></table>

    <h2>Citations (${envelope.citations.length})</h2>
    <table><thead><tr><th>#</th><th>type</th><th>ref</th><th>excerpt</th></tr></thead><tbody>${citationRows}</tbody></table>

    <h2>Agent invocations on this run</h2>
    <table><thead><tr><th>agent</th><th>child run id</th><th>status</th><th>summary</th><th>at</th></tr></thead><tbody>${childRows}</tbody></table>

    <h2>Audit trail (${auditTrail.length} events)</h2>
    <table><thead><tr><th>at</th><th>action</th><th>entity</th><th>user</th><th>changes</th></tr></thead><tbody>${auditRows}</tbody></table>

    ${
      envelope.warnings.length
        ? `<h2>Warnings recorded at run time</h2><ul>${envelope.warnings
            .map((w) => `<li><b>${htmlEscape(w.code)}:</b> ${htmlEscape(w.message)}</li>`)
            .join('')}</ul>`
        : ''
    }

    <div class="footer">This export is intended for litigation defense. The underlying PayEquityRun row + every audit event listed above are immutable; this artifact is reproducible from the same runId. Generated automatically; no manual editing.</div>
  `;

  return {
    format: 'pdf-html',
    filename: `pay-equity-defensibility-${isoDate(runAt)}.pdf`,
    mimeType: 'application/pdf',
    html: pdfShell({
      title: 'Pay Equity Defensibility Export',
      bodyHtml: body,
      watermark: 'DEFENSIBILITY EXPORT',
    }),
  };
}

/**
 * Phase 3.6 — Comp committee deck.
 *
 * Auto-slides PDF: title slide + headline slide + cohort slide + methodology
 * slide + recommendations slide. CSS @page breaks force one card per page.
 */
function renderCompCommitteeDeck(ctx: RenderContext): RenderOutput {
  const { envelope, tenantName, runAt, runId } = ctx;
  const r = envelope.output;
  const sigGaps = r.regressionResults.filter((x) => x.significance === 'significant');
  const worst = r.regressionResults
    .slice()
    .sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent))[0];
  const dimsCount =
    r.dimensions?.length ?? new Set(r.regressionResults.map((x) => x.dimension)).size;

  const slide = (content: string) =>
    `<section class="slide">${content}<div class="slide-footer">${htmlEscape(tenantName)} · Pay Equity · ${isoDate(runAt)} · ${htmlEscape(runId)}</div></section>`;

  const slides = [
    // 1. Title
    slide(`
      <div class="slide-title">
        <div class="kicker">Pay Equity</div>
        <h1>${htmlEscape(tenantName)} — Comp Committee Briefing</h1>
        <div class="meta">${isoDate(runAt)} · Methodology ${htmlEscape(envelope.methodology.name)}@${htmlEscape(envelope.methodology.version)}</div>
      </div>
    `),
    // 2. Headline
    slide(`
      <h2>Headline</h2>
      <div class="headline-grid">
        <div class="headline-card"><div class="label">Sample size</div><div class="value">${(envelope.methodology.sampleSize ?? 0).toLocaleString()}</div></div>
        <div class="headline-card"><div class="label">Significant gaps</div><div class="value">${sigGaps.length}</div></div>
        <div class="headline-card"><div class="label">Worst gap</div><div class="value">${worst ? pct(worst.gapPercent) : '—'}</div></div>
        <div class="headline-card"><div class="label">Dimensions</div><div class="value">${dimsCount}</div></div>
      </div>
      <p class="bullet">${
        sigGaps.length
          ? `${sigGaps.length} statistically-significant gap${sigGaps.length === 1 ? '' : 's'} identified.`
          : 'No statistically-significant gaps identified.'
      }</p>
    `),
    // 3. Cohort findings
    slide(`
      <h2>Cohort findings</h2>
      <table class="deck-table"><thead><tr><th>Cohort</th><th>Gap</th><th>p</th><th>n</th><th>Risk</th></tr></thead><tbody>
        ${r.regressionResults
          .slice(0, 8)
          .map(
            (x) =>
              `<tr><td>${htmlEscape(x.dimension)}/${htmlEscape(x.group)}</td><td>${pct(x.gapPercent)}</td><td>${x.pValue.toFixed(3)}</td><td>${x.sampleSize}</td><td>${severityBadge(x.riskLevel)}</td></tr>`,
          )
          .join('')}
      </tbody></table>
    `),
    // 4. Methodology
    slide(`
      <h2>Methodology</h2>
      <ul class="bullets">
        <li>Model: <b>${htmlEscape(envelope.methodology.name)}@${htmlEscape(envelope.methodology.version)}</b></li>
        <li>Dependent variable: <code>${htmlEscape(envelope.methodology.dependentVariable ?? 'log_salary')}</code></li>
        <li>Controls: ${envelope.methodology.controls.length === 0 ? '<i>none recorded</i>' : envelope.methodology.controls.map(htmlEscape).join(', ')}</li>
        <li>Sample: ${envelope.methodology.sampleSize.toLocaleString()} employees · CI ${(envelope.methodology.confidenceInterval * 100).toFixed(0)}%</li>
        <li>Citations: ${envelope.citations.length} regression coefficients backing the findings</li>
        <li>Confidence: <b>${htmlEscape(envelope.confidence)}</b></li>
      </ul>
    `),
    // 5. Recommendation
    slide(`
      <h2>Recommendation</h2>
      <p class="bullet">Estimated cost-to-close: <b>${(r.remediation?.totalCost ?? 0).toLocaleString()}</b> across <b>${r.remediation?.affectedEmployees ?? 0}</b> employees (avg adjustment ${(r.remediation?.avgAdjustment ?? 0).toLocaleString()}).</p>
      <ul class="bullets">
        <li>Approve the proposed remediation plan to bring the worst-cohort gap below 2%.</li>
        <li>Receive monthly pay-equity digest from this point forward.</li>
        <li>Re-run analysis after Q-end to confirm gap reduction.</li>
      </ul>
    `),
  ].join('');

  const deckCss = `
    *{box-sizing:border-box}
    body{margin:0;padding:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;background:#fff}
    .slide{position:relative;width:100%;min-height:100vh;padding:60px 72px;page-break-after:always;display:flex;flex-direction:column;justify-content:flex-start}
    .slide:last-child{page-break-after:auto}
    .slide-title{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;height:100%;min-height:80vh}
    .kicker{font-size:14px;letter-spacing:.2em;text-transform:uppercase;color:#64748b;margin-bottom:8px}
    h1{font-size:42px;margin:0 0 12px;letter-spacing:-.02em}
    h2{font-size:28px;margin:0 0 24px;letter-spacing:-.01em}
    .meta{color:#64748b;font-size:14px;margin-top:8px}
    .headline-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0}
    .headline-card{border:1px solid #e2e8f0;border-radius:10px;padding:20px}
    .headline-card .label{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
    .headline-card .value{font-size:32px;font-weight:700;margin-top:8px}
    .deck-table{border-collapse:collapse;width:100%;font-size:14px;margin-top:16px}
    .deck-table th{background:#f8fafc;text-align:left;padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600}
    .deck-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9}
    .bullets{font-size:16px;line-height:1.8;padding-left:20px}
    .bullet{font-size:18px;margin:16px 0}
    .badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600}
    .badge-high{background:#fee2e2;color:#991b1b}.badge-medium{background:#fef3c7;color:#92400e}.badge-low{background:#dcfce7;color:#166534}
    .slide-footer{position:absolute;bottom:24px;left:72px;right:72px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px}
  `;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comp Committee Deck</title><style>${deckCss}</style></head><body>${slides}</body></html>`;

  return {
    format: 'pdf-html',
    filename: `pay-equity-comp-committee-${isoDate(runAt)}.pdf`,
    mimeType: 'application/pdf',
    html,
  };
}

/**
 * Phase 6.1 — Employee personal equity statement.
 *
 * Per-employee PDF: their compa-ratio in context (level mid + range) without
 * exposing peer salaries. Privacy-aware. Requires `ctx.employee` to be set
 * (the calling service supplies it).
 */
function renderEmployeeStatement(ctx: RenderContext): RenderOutput {
  const { tenantName, runAt, runId, envelope } = ctx;
  const e = ctx.employee;

  if (!e) {
    return {
      format: 'pdf-html',
      filename: `pay-equity-employee-statement-${isoDate(runAt)}.pdf`,
      mimeType: 'application/pdf',
      html: pdfShell({
        title: 'Pay Equity — Employee Statement',
        bodyHtml:
          '<h1>Statement unavailable</h1><p>Employee context was not provided. Pass an employeeId when generating this report.</p>',
      }),
    };
  }

  const cr = e.compaRatio;
  const crBucket =
    cr === null
      ? 'unknown'
      : cr < 0.85
        ? 'below band'
        : cr < 0.95
          ? 'lower-half of band'
          : cr < 1.05
            ? 'mid-band'
            : cr < 1.15
              ? 'upper-half of band'
              : 'above band';
  const crBadgeCls =
    cr === null
      ? 'badge-medium'
      : cr < 0.85
        ? 'badge-high'
        : cr > 1.15
          ? 'badge-low'
          : 'badge-medium';

  // Position visualization: the band is conceptually p25..p75 around p50.
  // We show CR on a 0.7..1.3 scale so the employee sees where they sit.
  const barPosition = cr === null ? 50 : Math.max(0, Math.min(100, ((cr - 0.7) / 0.6) * 100));

  const body = `
    <h1>Your compensation in context</h1>
    <div class="meta">${htmlEscape(tenantName)} · ${isoDate(runAt)} · Confidential</div>

    <h2>Where you sit</h2>
    <p>You're at level <b>${htmlEscape(e.level)}</b> in <b>${htmlEscape(e.department)}</b>. Based on the latest pay equity analysis, your compensation sits at <b>${cr === null ? 'unavailable' : cr.toFixed(2) + ' compa-ratio'}</b> — <span class="badge ${crBadgeCls}">${htmlEscape(crBucket)}</span> for your level.</p>

    <div style="position:relative;height:24px;background:#f1f5f9;border-radius:12px;margin:24px 0;border:1px solid #e2e8f0">
      <div style="position:absolute;top:0;bottom:0;left:25%;width:50%;background:#dcfce7;border-radius:12px"></div>
      <div style="position:absolute;top:-4px;bottom:-4px;left:${barPosition}%;width:6px;background:#0f172a;border-radius:3px"></div>
      <div style="position:absolute;top:30px;left:25%;font-size:10px;color:#94a3b8">25th</div>
      <div style="position:absolute;top:30px;left:50%;font-size:10px;color:#94a3b8;transform:translateX(-50%)">midpoint</div>
      <div style="position:absolute;top:30px;left:75%;font-size:10px;color:#94a3b8">75th</div>
    </div>

    <h2>What this means</h2>
    <ul>
      <li>Compa-ratio = your salary divided by the midpoint for your level.</li>
      <li>Above 1.0 means you're paid more than the midpoint; below 1.0 means less.</li>
      <li>Most people sit between 0.85 and 1.15. Your individual position depends on tenure, performance, and market conditions when you were hired.</li>
      <li>If you have questions about your compensation, talk to your manager or HR partner. They have the full context to discuss your situation.</li>
    </ul>

    <h2>How this analysis was done</h2>
    <p>Your organization runs a regression-based pay equity analysis (${htmlEscape(envelope.methodology.name)}@${htmlEscape(envelope.methodology.version)}) controlling for ${envelope.methodology.controls.map(htmlEscape).join(', ') || 'level, tenure, and other factors'}. The model measures whether systematic pay differences exist after accounting for these legitimate factors.</p>

    <div class="footer">This statement is generated from PayEquityRun ${htmlEscape(runId)}. Specific peer salaries are never shown for privacy. For questions, contact HR.</div>
  `;

  return {
    format: 'pdf-html',
    filename: `pay-equity-statement-${e.employeeCode}-${isoDate(runAt)}.pdf`,
    mimeType: 'application/pdf',
    html: pdfShell({ title: 'Your compensation in context', bodyHtml: body }),
  };
}

/* ─── Dispatch ──────────────────────────────────────────────── */

export function renderReport(type: ReportType, ctx: RenderContext): RenderOutput {
  switch (type) {
    case 'board':
      return renderBoardPdf(ctx);
    case 'auditor':
      return renderAuditorPdf(ctx);
    case 'eu_ptd':
      return renderEuPtdCsv(ctx);
    case 'uk_gpg':
      return renderUkGpgCsv(ctx);
    case 'eeo1':
      return renderEeo1Csv(ctx);
    case 'sb1162':
      return renderSb1162Csv(ctx);
    case 'defensibility':
      return renderDefensibilityPdf(ctx);
    case 'comp_committee_deck':
      return renderCompCommitteeDeck(ctx);
    case 'employee_statement':
      return renderEmployeeStatement(ctx);
  }
}
