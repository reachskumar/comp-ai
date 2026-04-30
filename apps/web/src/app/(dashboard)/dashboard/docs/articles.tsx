import * as React from 'react';

export type Category = 'Pay Equity' | 'Letters' | 'Comp Cycles' | 'Platform';

export interface Article {
  slug: string;
  title: string;
  description: string;
  category: Category;
  audience: string;
  readTimeMin: number;
  body: React.ReactNode;
}

// ─── Reusable building blocks ──────────────────────────────────────

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 text-xl font-semibold tracking-tight text-foreground">{children}</h2>;
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-base font-semibold text-foreground">{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</p>;
}
function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm text-muted-foreground">
      {children}
    </ul>
  );
}
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}
function Callout({
  kind = 'info',
  title,
  children,
}: {
  kind?: 'info' | 'warn' | 'success';
  title?: string;
  children: React.ReactNode;
}) {
  const palette =
    kind === 'warn'
      ? 'border-amber-200 bg-amber-50/40 text-amber-900'
      : kind === 'success'
        ? 'border-emerald-200 bg-emerald-50/40 text-emerald-900'
        : 'border-blue-200 bg-blue-50/40 text-blue-900';
  return (
    <div className={`mt-4 rounded-md border p-3 text-xs ${palette}`}>
      {title && <div className="mb-1 font-semibold">{title}</div>}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
function Table({ headers, rows }: { headers: string[]; rows: Array<React.ReactNode[]> }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border last:border-0">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top text-sm">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Articles ──────────────────────────────────────────────────────

export const ARTICLES: Article[] = [
  {
    slug: 'pay-equity-overview',
    title: 'Pay Equity — what it is and how it works',
    description: 'One-page overview: regression, envelope, agents, reports, tabs.',
    category: 'Pay Equity',
    audience: 'Everyone',
    readTimeMin: 4,
    body: (
      <>
        <P>
          The Pay Equity workspace runs an <Code>OLS regression</Code> on employee compensation,
          controlling for job level, tenure, performance, location, and department. The β
          coefficient on the protected-class indicator (gender, race, ethnicity, etc.) is the{' '}
          <strong>adjusted pay gap</strong> — what&apos;s left after controlling for legitimate
          factors.
        </P>
        <P>
          We wrap each result in an immutable, auditor-defensible envelope (citations + methodology
          version + warnings + confidence), persist it as a <Code>PayEquityRun</Code> row, and
          surface it through five workflow tabs: Overview, Diagnose, Remediate, Reports, Prevent.
        </P>
        <H2>Why it&apos;s designed this way</H2>
        <P>Three principles drove every architectural decision:</P>
        <UL>
          <li>
            <strong>Auditor-defensible.</strong> Every numeric claim cites its source. Methodology
            is versioned per-run. Old runs reproduce exactly.
          </li>
          <li>
            <strong>Anti-hallucination.</strong> The service pre-computes every number; the LLM only
            narrates. No agent invents a percent or a count.
          </li>
          <li>
            <strong>Privacy by default.</strong> Cohorts with fewer than 5 employees are suppressed
            before they reach an LLM. Specific peer salaries never appear in employee-facing
            outputs.
          </li>
        </UL>
        <H2>The five tabs at a glance</H2>
        <Table
          headers={['Tab', 'What it does', 'Who uses it']}
          rows={[
            [
              'Overview',
              'Run an analysis, see the headline status, talk to the copilot, view methodology + audit trail',
              'CHRO, HRBP, manager',
            ],
            [
              'Diagnose',
              'Trend chart, cohort heatmap, drill-down with stat tests, outliers, AI root-cause analysis',
              'HRBP, comp analyst',
            ],
            [
              'Remediate',
              'Compute proposed adjustments, approve/decline, apply (writes Employee.baseSalary), stage letters',
              'HRBP, comp lead',
            ],
            [
              'Reports',
              'Download nine report types; schedule recurring delivery; mint share links for external auditors',
              'HRBP, comp committee, external auditors',
            ],
            [
              'Prevent',
              'AIR (80% rule), pay band drift, pre-decision equity check, 12-month forecast with hiring scenarios',
              'CHRO, HRBP, recruiter',
            ],
          ]}
        />
        <Callout kind="info" title="Want the deep dive?">
          See the repo docs: <Code>PAY_EQUITY_HOW_IT_WORKS.md</Code> covers the full math and code
          references; the build bible <Code>PAY_EQUITY_CONTEXT.md</Code> tracks design decisions.
        </Callout>
      </>
    ),
  },
  {
    slug: 'pay-equity-running-an-analysis',
    title: 'Running a Pay Equity analysis',
    description: 'What happens when you click Run on the Overview tab — the six steps, end-to-end.',
    category: 'Pay Equity',
    audience: 'Engineers, comp analysts',
    readTimeMin: 4,
    body: (
      <>
        <P>
          Click <strong>Run analysis</strong> on the Overview tab and pick the protected-class
          dimensions to evaluate (gender, ethnicity, age band, department, location). The pipeline
          executes six steps. Every step is recoverable: if anything throws, the run row stays as{' '}
          <Code>FAILED</Code> with the error, never silently lost.
        </P>
        <H3>1. Pre-create the run row (status = PENDING)</H3>
        <P>
          The row is created first so we have a <Code>runId</Code> even if the analysis itself blows
          up. Every downstream artifact (citations, audit logs, share tokens) ties back to it.
        </P>
        <H3>2. Run the statistical engine</H3>
        <P>The legacy analyzer does three things:</P>
        <UL>
          <li>OLS regression per dimension (see &ldquo;The math&rdquo; doc).</li>
          <li>Compa-ratio aggregation per group: avg, median, min, max, stddev.</li>
          <li>Remediation cost estimate to bring underpaid employees to cohort midpoint.</li>
        </UL>
        <H3>3. Build the envelope</H3>
        <P>
          Wrap the statistical output in <Code>PayEquityAgentResult&lt;T&gt;</Code> with citations
          (each regression coefficient becomes one), methodology snapshot, and warnings.
        </P>
        <H3>4. Compute warnings</H3>
        <UL>
          <li>
            <Code>k_anonymity_violation</Code> — any cohort with n&lt;5 is suppressed and never
            reaches an LLM.
          </li>
          <li>
            <Code>sample_size_low</Code> — any cohort with n&lt;30 is flagged but still reported.
          </li>
        </UL>
        <H3>5. Compute confidence</H3>
        <P>
          <Code>high</Code> when sample &gt; 200 with zero warnings; <Code>low</Code> when any
          sample-size warning fires; <Code>medium</Code> otherwise.
        </P>
        <H3>6. Persist + audit</H3>
        <P>
          Update the row to <Code>COMPLETE</Code>, write an <Code>AuditLog</Code> row with action{' '}
          <Code>PAY_EQUITY_RUN</Code>. The envelope is now <strong>immutable</strong> — every
          report, every drill-down, every AI agent draws from this exact JSON for the lifetime of
          the run.
        </P>
        <Callout kind="success" title="What you'll see on the Overview">
          A single PayEquityRun row, an updated status bar (worst gap / significant gaps / sample
          size / confidence), and an audit-log entry. The LLM has not been called yet — that happens
          when you click an action like &ldquo;Analyze root cause&rdquo; or &ldquo;Run
          forecast&rdquo;.
        </Callout>
      </>
    ),
  },
  {
    slug: 'pay-equity-the-math',
    title: 'The statistical core — regression, gap %, AIR, compa-ratio',
    description: 'What the regression actually does, and how each headline number is derived.',
    category: 'Pay Equity',
    audience: 'Comp analysts, consultants',
    readTimeMin: 5,
    body: (
      <>
        <H2>The regression</H2>
        <P>
          For each cohort (e.g., gender = Female with Male as the reference group), we run a
          multivariate OLS:
        </P>
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
          {`salary_i = β₀ + β₁ × group_i
         + β₂ × control_i² + β₃ × control_i³ + ...
         + ε_i`}
        </pre>
        <UL>
          <li>
            <Code>salary_i</Code> — employee i&apos;s annual base salary
          </li>
          <li>
            <Code>group_i</Code> — 1 if employee i is in the protected class being tested, else 0
          </li>
          <li>
            <Code>control_i...</Code> — level (numeric encoding), tenure in months, performance
            rating, location dummies, department dummies
          </li>
          <li>
            <Code>β₁</Code> — the <strong>adjusted pay gap in dollars</strong>: what&apos;s left
            after controlling for the legitimate factors above
          </li>
        </UL>
        <H2>From β to &ldquo;adjusted gap percent&rdquo;</H2>
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
          {`gapPercent = (β₁ / mean_salary_in_cohort) × 100`}
        </pre>
        <P>
          So if β₁ = −3,200 and the cohort mean salary is $100,000, the adjusted gap is{' '}
          <strong>−3.2%</strong> — women in the cohort are paid 3.2% less than men <em>after</em>{' '}
          controlling for level, tenure, performance, location, and department.
        </P>
        <H2>Significance</H2>
        <Table
          headers={['p-value', 'Label', 'What it means']}
          rows={[
            ['p < 0.05', 'significant', 'Chance the gap is random < 5%'],
            ['p < 0.10', 'marginal', 'Suggestive but not conclusive'],
            ['otherwise', 'not_significant', 'Could be noise'],
          ]}
        />
        <H2>Risk level</H2>
        <UL>
          <li>
            <Code>HIGH</Code> — |gap| &gt; 5% AND p &lt; 0.05
          </li>
          <li>
            <Code>MEDIUM</Code> — |gap| &gt; 2% AND p &lt; 0.10
          </li>
          <li>
            <Code>LOW</Code> — everything else
          </li>
        </UL>
        <H2>Compa-ratio (CR)</H2>
        <P>
          Independent of the regression: <Code>CR_i = salary_i / band_midpoint_for_employee_i</Code>
          . <Code>&lt; 0.85</Code> is below band, <Code>0.85–1.15</Code> is in band,{' '}
          <Code>&gt; 1.15</Code> is above band. CR ignores controls but is directly actionable. We
          use it for outlier detection and the 80%-rule check.
        </P>
        <H2>AIR (80% rule)</H2>
        <P>
          <Code>AIR = exp(β₁)</Code>. When AIR &lt; 0.8 the cohort fails the OFCCP four-fifths rule
          (federal-contractor adverse impact). Severity is <Code>high</Code> only when AIR &lt; 0.8
          AND p &lt; 0.05.
        </P>
        <Callout kind="warn" title="Implementation honesty">
          The current regression uses linear salary as the dependent variable, not log(salary). The
          methodology field says <Code>log_salary</Code> because that&apos;s the canonical EDGE
          framing, but the code passes raw salaries. For most cohorts the direction + significance
          agree; comp consultants validating a customer filing should know.
        </Callout>
      </>
    ),
  },
  {
    slug: 'pay-equity-ai-agents',
    title: 'The six AI agents — when each fires and what it does',
    description:
      'Cohort root-cause, outlier explainer, remediation justifier, projection, copilot, narrative.',
    category: 'Pay Equity',
    audience: 'Engineers, product',
    readTimeMin: 5,
    body: (
      <>
        <P>
          Every Pay Equity LLM agent returns the same envelope shape (
          <Code>PayEquityAgentResult&lt;T&gt;</Code>) with citations, methodology snapshot,
          confidence, warnings, and a runId. The four design rules:
        </P>
        <UL>
          <li>
            <strong>Numbers come from inputs, never the model.</strong> The service pre-computes
            distributions, peer means, sibling cohorts. The agent narrates over them.
          </li>
          <li>
            <strong>Citations required.</strong> Every claim references regression coefficients,
            employee rows, or cohort queries.
          </li>
          <li>
            <strong>Methodology versioned per-run.</strong> If controls change, the version bumps
            and you get a new immutable row. Old runs still reproduce.
          </li>
          <li>
            <strong>k-anonymity at the agent boundary.</strong> A cohort with n&lt;5 never reaches
            an LLM.
          </li>
        </UL>
        <Table
          headers={['Agent', 'Triggered by', 'What you get']}
          rows={[
            [
              <strong key="1">Cohort root-cause</strong>,
              'Click "Analyze root cause" on a cohort cell in the Diagnose heatmap',
              '3–5 ranked root-cause factors with contribution % + recommended next step',
            ],
            [
              <strong key="2">Outlier explainer</strong>,
              'Click "Explain" on an employee in the outlier list',
              'Per-employee paragraph + recommended action + severity',
            ],
            [
              <strong key="3">Remediation justifier</strong>,
              'Click "Compute proposals" on the Remediate tab',
              'Per-adjustment one-line justifications + plan summary + alternative scenarios',
            ],
            [
              <strong key="4">Projection</strong>,
              'Click "Run forecast" on the Prevent tab',
              'Drivers + recommended actions + risk level + 12-month narrative',
            ],
            [
              <strong key="5">Copilot</strong>,
              'Type a question into the Copilot card on the Overview tab',
              'Bounded answer (or refusal if out-of-scope) + scope label + highlights + follow-ups',
            ],
            [
              <strong key="6">Narrative report</strong>,
              <em key="6e">
                Wired but currently structural-only — defers to the deterministic envelope
              </em>,
              'Executive summary + EDGE compliance + key findings + risk assessment',
            ],
          ]}
        />
        <H2>Each invocation persists its own run</H2>
        <P>
          Every AI call writes a child <Code>PayEquityRun</Code> row with the right{' '}
          <Code>agentType</Code> (<Code>cohort_root_cause</Code>, <Code>outlier_explainer</Code>,{' '}
          <Code>remediation</Code>, <Code>projection</Code>, <Code>copilot</Code>). This means the
          trend chart can show &ldquo;this cohort was analyzed 3 times in the last week&rdquo;, and
          the audit trail captures every AI run, every input, every output.
        </P>
        <H2>What out-of-scope looks like</H2>
        <P>
          The Copilot is the most aggressive about refusing. Out-of-scope examples (firing,
          legal-advice questions, specific salaries for non-team employees) get a one-sentence
          refusal recorded in <Code>output.refusalReason</Code>, not a fabricated answer. The audit
          log records the refusal too.
        </P>
      </>
    ),
  },
  {
    slug: 'pay-equity-remediate',
    title: 'Remediate — propose, decide, apply',
    description: 'How adjustments are computed, approved, and written back to Employee.baseSalary.',
    category: 'Pay Equity',
    audience: 'HRBP, comp lead',
    readTimeMin: 4,
    body: (
      <>
        <H2>How proposals are generated</H2>
        <P>The service computes proposals deterministically — no LLM involved in the math:</P>
        <UL>
          <li>Find every employee in a statistically-significant cohort with CR &lt; 1.0</li>
          <li>
            Compute their target salary as the cohort mean × CR=1.0 (i.e., bring them to midpoint)
          </li>
          <li>
            Cap the per-employee adjustment at <Code>maxPerEmployeePct</Code> (default 15%)
          </li>
          <li>Sort by lowest CR first — biggest fixes near the top</li>
        </UL>
        <P>
          Then the AI agent narrates a one-line justification per row plus a plan summary plus 1–3
          alternative scenarios. Every number in the narrative comes from the input.
        </P>
        <H2>The lifecycle</H2>
        <Table
          headers={['Status', 'How you get there', 'What happens']}
          rows={[
            [
              <Code key="1">PROPOSED</Code>,
              'Click "Compute proposals"',
              'Bulk insert of PayEquityRemediation rows + child run row + audit',
            ],
            [<Code key="2">APPROVED</Code>, 'Click ✓ on a row', 'Status flip + audit row'],
            [<Code key="3">DECLINED</Code>, 'Click ✗ on a row', 'Status flip + audit row'],
            [
              <Code key="4">APPLIED</Code>,
              'Click "Apply approved"',
              'Employee.baseSalary updated for every APPROVED row, status flips to APPLIED, one audit row per change',
            ],
          ]}
        />
        <H2>Phased multi-quarter plan (2.4)</H2>
        <P>
          For larger remediation sets, use the phased plan endpoint to split rows into N quarter
          buckets (1..8). Round-robin assignment after sorting by absolute delta DESC, so biggest
          fixes go first and spread evenly. Read-only; you still apply per-quarter through the
          standard decide + apply flow.
        </P>
        <H2>Letters hook (2.6)</H2>
        <P>
          After APPLIED, the Letters module can stage a DRAFT compensation letter per remediation —
          one click in the Reports tab. The letter carries the from/to/delta/justification in{' '}
          <Code>compData</Code> and links back to the remediation via{' '}
          <Code>metadata.remediationId</Code>.
        </P>
        <Callout kind="info" title="Why direct salary writeback, not a CompCycle?">
          Pay equity remediations are ad-hoc corrections, not cycle decisions. Forcing them through
          CompCycle would co-mingle merit/promo budgets and require a fake cycle wrapper for every
          apply. We still emit a per-row AuditLog and persist PayEquityRemediation status APPLIED —
          same audit story, less plumbing.
        </Callout>
      </>
    ),
  },
  {
    slug: 'pay-equity-reports',
    title: 'Reports — nine artifact types',
    description:
      'Board PDF, statutory CSVs, auditor + defensibility, comp committee deck, employee statement.',
    category: 'Pay Equity',
    audience: 'CHRO, HRBP, regulatory filer',
    readTimeMin: 5,
    body: (
      <>
        <P>
          All reports route through the same endpoint and read the immutable run envelope. Renderers
          are pure functions — no LLM involved. CSVs are BOM-prefixed UTF-8 (Excel opens them
          cleanly); PDFs render through Puppeteer.
        </P>
        <Table
          headers={['Type', 'Format', 'Audience', 'What it is']}
          rows={[
            [
              'Board narrative',
              'PDF',
              'Board / CFO',
              'Executive summary, headline cards, cohort findings, methodology box',
            ],
            [
              'EU PTD',
              'CSV',
              'EU regulatory filer',
              'Article 9 disclosure (Directive (EU) 2023/970)',
            ],
            [
              'UK GPG',
              'CSV',
              'UK regulatory filer',
              'Six required figures for gov.uk Gender Pay Gap reporting',
            ],
            ['EEO-1 Component 1', 'CSV', 'US federal contractor', '29 CFR §1602.7 disclosure'],
            ['CA SB 1162', 'CSV', 'CA filer', 'California Pay Data Report (Labor Code §12999)'],
            [
              'Auditor',
              'PDF',
              'External auditor',
              'Anonymized — tenant id sha256-hashed, watermarked "AUDITOR EXPORT"',
            ],
            [
              'Defensibility',
              'PDF',
              'Internal counsel',
              'Comprehensive — methodology + full regression + every audit event + every child agent invocation. Identifiers NOT hashed.',
            ],
            [
              'Comp committee deck',
              'PDF',
              'Comp committee',
              '5-slide PDF (title / headline / cohort / methodology / recommendation), one slide per page',
            ],
            [
              'Employee statement',
              'PDF',
              'Individual employee',
              'Privacy-aware — compa-ratio plotted on 0.7..1.3 scale with band quartiles, no peer salaries shown',
            ],
          ]}
        />
        <Callout kind="warn" title="Statutory CSV honesty">
          Fields that need source data we don&apos;t yet have (bonus pay gap, hourly-rate quartiles,
          race/ethnicity grids, EEO job categories) emit the literal string{' '}
          <Code>not_available</Code> rather than blank. A customer cannot file as-is — see{' '}
          <Code>STATUTORY_CSV_REVIEW_CHECKLIST.md</Code> for the per-jurisdiction gap list. ~2-3
          days of canonical-schema plumbing + one comp-lawyer review pass closes the gap.
        </Callout>
        <H2>Audit + immutability</H2>
        <P>
          Each export writes an AuditLog row (action <Code>PAY_EQUITY_REPORT_EXPORTED</Code>); no
          child PayEquityRun is created since the envelope is already immutable. The report bytes
          generated today and the bytes generated months from now from the same <Code>runId</Code>{' '}
          are byte-identical — that&apos;s the auditor-defensibility story.
        </P>
      </>
    ),
  },
  {
    slug: 'pay-equity-predict-prevent',
    title: 'Predict & Prevent — forecast, AIR, drift, pre-decision check',
    description:
      'How the 12-month forecast works, the 80% rule, pay band drift, and the equity guardrail for promotions / salary changes / new hires.',
    category: 'Pay Equity',
    audience: 'CHRO, HRBP, recruiter',
    readTimeMin: 5,
    body: (
      <>
        <H2>12-month forecast</H2>
        <P>
          The forecast extrapolates the worst-cohort gap from the last 6 narrative runs at
          checkpoints t+1 / t+3 / t+6 / t+horizon months. Slope = linear best-fit on the historical
          gap series. 95% CI from observed run-to-run sigma (fallback ±1pp when fewer than 3 runs
          exist).
        </P>
        <P>
          A scenario (hiring plan + promotion plan) layers on top. The math is composition-based,
          not fixed coefficients:
        </P>
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
          {`For each hire of K employees in group G:
  share  = K / (N + K)         // share of the new cohort
  impact = share × |gap| × 0.5 // a hire moves one of two group means
  sign   = +1 if G is reference, −1 if minority

For each promotion: same math × 1.5 (level mix shift)
Cap total at ±15pp.`}
        </pre>
        <P>
          So 50 hires in a 100-person cohort matter much more than 50 hires in a 10,000-person
          cohort, and a scenario on a 1% gap shifts proportionally less than the same scenario on a
          15% gap. Both improvements over a flat per-employee constant.
        </P>
        <P>
          Then the projection AI agent narrates: which factors drive the trajectory, what the risk
          level is, and 2–4 concrete actions ordered by priority. Numbers come from the
          deterministic series; the LLM never invents one.
        </P>
        <H2>AIR (80% rule)</H2>
        <P>
          <Code>AIR = exp(β₁)</Code> per cohort, where β₁ is the regression coefficient on the
          protected-class indicator. AIR &lt; 0.8 fails the OFCCP four-fifths rule. Severity is{' '}
          <Code>high</Code> only when AIR &lt; 0.8 AND p &lt; 0.05. Read-only; computed inline from
          the latest run envelope.
        </P>
        <H2>Pay band drift</H2>
        <P>
          Compares weighted-mean compa-ratio across the last 6 runs. Falling CR over time = bands
          are outpacing salaries (drift); rising = opposite. Verdict: <Code>bands_outpacing</Code> /{' '}
          <Code>salaries_outpacing</Code> / <Code>stable</Code>. No new schema required — uses the
          existing run envelope&apos;s <Code>compaRatios</Code> field.
        </P>
        <H2>Pre-decision equity check</H2>
        <P>
          Stage hypothetical changes (promotion / salary change / new hire) and get a verdict before
          applying:
        </P>
        <UL>
          <li>
            <Code>safe</Code> — projected gap delta within ±0.10pp of baseline
          </li>
          <li>
            <Code>warn</Code> — delta &gt; 0.10pp; proceed with awareness
          </li>
          <li>
            <Code>block</Code> — delta &gt; 0.50pp; review before applying
          </li>
        </UL>
        <P>
          Plus per-employee CR floor: any salary change that would project CR &lt; 0.85 flags the
          employee with severity <Code>high</Code>. Sub-100ms, no LLM — designed to be called inline
          from /comp-cycles when a manager edits a recommendation, or from a recruiter offer screen
          before sending an offer.
        </P>
      </>
    ),
  },
  {
    slug: 'pay-equity-trust',
    title: 'Trust — methodology, audit trail, defensibility',
    description: 'How the auditor-defensibility story is built into every run.',
    category: 'Pay Equity',
    audience: 'CHRO, internal counsel, external auditor',
    readTimeMin: 4,
    body: (
      <>
        <H2>Three immutability invariants</H2>
        <UL>
          <li>
            <strong>The PayEquityRun envelope is never mutated.</strong> Once a run is{' '}
            <Code>COMPLETE</Code>, its <Code>result</Code> JSON is frozen. Reports generated weeks
            or months later draw from the same envelope reproducibly.
          </li>
          <li>
            <strong>Methodology is pinned per-run.</strong> A run stamps name + version at creation.
            If we change controls, dependent variable, or threshold, the version bumps and the new
            run gets the new methodology. Old runs continue to reproduce as they originally did.
          </li>
          <li>
            <strong>The audit log is append-only.</strong> Every action writes a row; nothing is
            updated or deleted.
          </li>
        </UL>
        <H2>What you can pull from a single runId</H2>
        <UL>
          <li>The original report bytes (board / EU PTD / etc.)</li>
          <li>The original AI narrative (cohort root-cause, projection, etc.)</li>
          <li>Every action taken on the run, who did it, when, and what changed</li>
          <li>Every child agent invocation tied to it</li>
          <li>Every remediation row that flowed from it</li>
        </UL>
        <H2>Defensibility export</H2>
        <P>
          Litigation-ready PDF — methodology + full regression detail + citations + every audit
          event + every child agent invocation. Watermarked &ldquo;DEFENSIBILITY EXPORT&rdquo;.
          Identifiers <strong>not</strong> hashed (this is internal use, distinct from the auditor
          export which is anonymized for external review).
        </P>
        <H2>External auditor portal (5.5)</H2>
        <P>
          Mint a share token bound to a specific run. The auditor accesses the read-only auditor or
          defensibility PDF via a public URL — no tenant account needed. Tokens expire (default 30
          days), can be revoked instantly, and every redemption is audit-logged with{' '}
          <Code>accessCount</Code> + <Code>lastAccessedAt</Code>. Tenant-scoped sha256 hashes
          prevent cross-tenant correlation.
        </P>
      </>
    ),
  },
  {
    slug: 'pay-equity-copilot',
    title: 'Manager Equity Copilot — bounded RAG Q&A',
    description: 'How the Overview Copilot answers managers without making things up.',
    category: 'Pay Equity',
    audience: 'Manager, HRBP',
    readTimeMin: 3,
    body: (
      <>
        <P>
          The Copilot card on the Overview tab is a <strong>bounded-RAG</strong> Q&amp;A. The
          service resolves the asking user → Employee row by email, loads up to 50 direct reports,
          plus the latest org narrative run, and hands all of that to the LLM. The LLM only answers
          using those facts.
        </P>
        <H2>What&apos;s in scope</H2>
        <UL>
          <li>
            Questions about the manager&apos;s direct reports (CR, salary, level, gap from cohort
            mean)
          </li>
          <li>Questions about the org-wide PE findings the workspace already produced</li>
          <li>
            Questions about how a hiring or remediation action would affect the team&apos;s equity
          </li>
        </UL>
        <H2>What&apos;s out of scope</H2>
        <UL>
          <li>Performance management, firing, headcount planning unrelated to equity</li>
          <li>Specific salaries for employees outside the manager&apos;s direct reports</li>
          <li>Legal advice (&ldquo;can I be sued for...&rdquo;)</li>
          <li>Anything not derivable from the input data</li>
        </UL>
        <P>
          Out-of-scope questions get a one-sentence refusal recorded in{' '}
          <Code>output.refusalReason</Code>, not a fabricated answer. The audit log records the
          refusal too.
        </P>
        <H2>What you see</H2>
        <UL>
          <li>
            <strong>Scope badge:</strong> team / org / out_of_scope
          </li>
          <li>
            <strong>Highlights:</strong> 0–4 key facts the answer used (with explicit values)
          </li>
          <li>
            <strong>Follow-up suggestions:</strong> 0–3 concrete next questions
          </li>
          <li>
            <strong>Citations:</strong> count of regression + employee-row references
          </li>
        </UL>
        <Callout kind="info" title="Tolerance for missing data">
          If the JWT user has no Employee row (e.g., admin-only accounts), team-scope queries return
          empty and the agent gracefully falls back to org-scope answers. No tenant-account
          dependency on the manager&apos;s side.
        </Callout>
      </>
    ),
  },
  {
    slug: 'pay-equity-distribution',
    title: 'Distribution — subscriptions, CHRO digest, share tokens',
    description:
      'How reports get scheduled, the daily CHRO digest, and the public share-token portal.',
    category: 'Pay Equity',
    audience: 'CHRO, HRBP',
    readTimeMin: 3,
    body: (
      <>
        <H2>Scheduled subscriptions (3.7)</H2>
        <P>
          A row in <Code>PEReportSubscription</Code> tells the system: &ldquo;send me this report on
          this cadence to these recipients&rdquo;. The cron ticks hourly (BullMQ repeatable job),
          finds subscriptions whose <Code>nextRunAt</Code> is due, generates the artifact, sends it
          via email + optional Slack incoming-webhook, and reschedules.
        </P>
        <UL>
          <li>
            <strong>Cadence:</strong> daily / weekly / monthly / quarterly
          </li>
          <li>
            <strong>Channels:</strong> email (always) + Slack webhook (optional)
          </li>
          <li>
            <strong>Errors:</strong> recorded in <Code>lastError</Code> with the next run still
            scheduled — operators can fix and the next tick retries
          </li>
        </UL>
        <H2>CHRO daily digest (6.4)</H2>
        <P>
          Same infra with <Code>reportType = digest</Code>. The composer pulls{' '}
          <Code>getOverview()</Code> and emits a 4-line summary: worst-cohort gap, significant gaps,
          sample size + confidence, methodology, optional Δ vs the previous run. Sent via email +
          optional Slack.
        </P>
        <H2>External auditor portal (5.5)</H2>
        <P>
          Mint a read-only share token in the Reports tab. The token is a random 24-byte base64url
          string bound to a specific run; it expires (default 30 days) and can be revoked instantly.
          The auditor accesses <Code>https://your-domain/api/v1/pe-share/&lt;token&gt;</Code> — no
          tenant login.
        </P>
        <UL>
          <li>
            <strong>Throttle:</strong> 60 redemptions per minute per route
          </li>
          <li>
            <strong>Audit:</strong> every redemption increments <Code>accessCount</Code> and updates{' '}
            <Code>lastAccessedAt</Code>
          </li>
          <li>
            <strong>Scope:</strong> auditor (anonymized) / defensibility (full) / methodology
            (anonymized)
          </li>
        </UL>
      </>
    ),
  },
  {
    slug: 'pay-equity-privacy',
    title: 'Privacy — k-anonymity, hashing, redaction',
    description:
      'Four enforcement points that keep individual data out of LLM channels and external exports.',
    category: 'Pay Equity',
    audience: 'CHRO, security, internal counsel',
    readTimeMin: 3,
    body: (
      <>
        <H2>Enforcement points</H2>
        <UL>
          <li>
            <strong>k-anonymity at the regression boundary.</strong> Cohorts with n&lt;5 are
            suppressed before the envelope is built. The cell still appears in the output but with{' '}
            <Code>suppressed: true</Code> and no statistics.
          </li>
          <li>
            <strong>k-anonymity at the agent boundary.</strong> Even if a cohort survived the first
            check, the LLM-invoking services double-check before calling the agent. A small cohort
            never gets near a model.
          </li>
          <li>
            <strong>Auditor export hashing.</strong> The auditor PDF replaces tenant id with a
            tenant-scoped sha256 hash (12 hex chars). Cross-tenant correlation is impossible because
            the hash includes the tenant id as salt.
          </li>
          <li>
            <strong>Employee statement redaction.</strong> The per-employee personal equity
            statement plots their compa-ratio on a 0.7..1.3 scale with band quartiles, but never
            shows specific peer salaries. Hard-coded in the renderer.
          </li>
        </UL>
        <H2>Defensibility export — when raw IDs are appropriate</H2>
        <P>
          The defensibility PDF is the one report type that does <strong>not</strong> hash
          identifiers. That&apos;s deliberate — it&apos;s an internal litigation artifact for
          counsel who needs to cross-reference HR systems. Privacy is handled by routing (the JWT
          permission gate), not the artifact itself. The auditor PDF is the anonymized variant for
          external review.
        </P>
      </>
    ),
  },
  {
    slug: 'pay-equity-faq',
    title: "FAQ — limits and what we don't do (yet)",
    description: 'Honest list of boundaries and where things head next.',
    category: 'Pay Equity',
    audience: 'Everyone',
    readTimeMin: 4,
    body: (
      <>
        <H3>Can a customer file an EU PTD / UK GPG / EEO-1 / SB 1162 report directly from this?</H3>
        <P>
          Not yet. The CSVs are correctly shaped but field-perfect filing requires (a) source data
          we don&apos;t yet plumb (hourly rates, bonus components, EEO job category mapping,
          establishment IDs), and (b) a comp-lawyer review pass per jurisdiction. See{' '}
          <Code>STATUTORY_CSV_REVIEW_CHECKLIST.md</Code> for the per-jurisdiction gap list. About
          2–3 days of canonical-schema plumbing closes most of it.
        </P>
        <H3>Why is the dependent variable linear salary, not log(salary)?</H3>
        <P>
          The bible documents <Code>log_salary</Code> because that&apos;s the canonical EDGE
          framing, but the current implementation uses raw salary. For most cohorts the direction
          and significance agree; comp consultants validating a customer filing should know.
          Switching is a one-line code change + a methodology version bump.
        </P>
        <H3>Are the projection coefficients from a real comp-consultant model?</H3>
        <P>
          They were initially fixed constants (0.05pp/hire, 0.10pp/promotion). We replaced them with{' '}
          <strong>composition math</strong> derivable from the run envelope (cohort size, current
          gap, scenario size), capped at ±15pp. No external coefficient — the math is
          self-justifying from inputs. The previous &ldquo;needs comp-consultant validation&rdquo;
          caveat is gone.
        </P>
        <H3>What happens if our HRIS doesn&apos;t have race/ethnicity data?</H3>
        <P>
          The workspace degrades gracefully — gender-only analysis still runs. Reports that need
          race/ethnicity (EEO-1, SB 1162) emit those columns as <Code>not_available</Code>. Other
          dimensions (department, location) still work.
        </P>
        <H3>Why do you use compa-ratio AIR instead of selection-rate AIR?</H3>
        <P>
          Selection-rate AIR (events: hires, promotions) needs an event log we don&apos;t yet track.
          Compa-ratio AIR (<Code>exp(β)</Code>) is the OFCCP-aligned proxy and uses the regression
          we already run. When promotion-event data lands, we&apos;ll add a second AIR mode.
        </P>
        <H3>How does this work with our existing comp-cycle module?</H3>
        <P>
          The Pre-decision check endpoint is designed to be called inline from{' '}
          <Code>/comp-cycles/my-team</Code>: when a manager edits a recommendation, the cycle module
          posts the proposed change and gets back a verdict (safe / warn / block) with flagged
          employees. Sub-100ms, no LLM. The cycle UI shows the verdict inline before save.
        </P>
        <H3>Can I run an analysis without an LLM?</H3>
        <P>
          Yes — the entire <Code>runAnalysis</Code> pipeline is deterministic. The LLM agents only
          fire on explicit user actions (Analyze root cause, Compute proposals, Run forecast, Ask
          copilot). If the LLM is down, those actions fail with a clear error; everything else
          continues to work.
        </P>
      </>
    ),
  },
];

export const ARTICLES_BY_CATEGORY: Record<Category, Article[]> = ARTICLES.reduce(
  (acc, a) => {
    acc[a.category] = acc[a.category] ?? [];
    acc[a.category]!.push(a);
    return acc;
  },
  {} as Record<Category, Article[]>,
);

export function findArticle(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}
