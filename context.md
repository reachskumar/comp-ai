# CONTEXT.md — CompportIQ Engineering Ground Truth
#
# Generated: 2026-04-11
# Source: Full codebase audit (5 parallel agents, read-only)
#
# ════════════════════════════════════════════════════════════
# EVERY Claude Code session MUST read this file completely
# before writing a single line of code.
# Update this file whenever architecture or status changes.
# ════════════════════════════════════════════════════════════
#
# CONFIDENCE MARKERS USED IN THIS FILE:
#
# [CONFIRMED-CODE]   — verified by reading the actual source file.
#                      File path and line number available.
# [CONFIRMED-LOG]    — verified from production log output.
# [CONFIRMED-SCHEMA] — verified from schema.prisma directly.
# [INFERRED]         — logical inference from confirmed facts.
#                      Treat as probable but verify before relying on it.
# [NEEDS-VERIFY]     — not confirmed. Must query DB or read file
#                      before using this in code.
# [ASSUMPTION]       — working assumption. Flag if wrong.

---

## ═══════════════════════════════════════════
## SECTION 0 — HOW TO USE THIS FILE
## ═══════════════════════════════════════════

Before starting ANY task:
  1. Read SECTION 1 — ACTIVE BLOCKERS first
  2. Read the section for the area you are working in
  3. Check SECTION 9 — GO-LIVE CHECKLIST for your task's status
  4. Read SECTION 10 — RULES before writing code
  5. Never skip to coding without completing steps 1-4

Status markers on checklist items:
  ✅ DONE       — verified working, confirmed in prod
  🔴 BROKEN     — confirmed broken right now
  🔄 IN PROGRESS — being actively fixed this session
  ⬜ NOT STARTED — known gap, work not begun
  ⚠️  RISK       — working but has known fragility

---

## ═══════════════════════════════════════════
## SECTION 1 — ACTIVE BLOCKERS
## ═══════════════════════════════════════════
## Read this before anything else.
## Do not build on top of these. Fix them first.
## ═══════════════════════════════════════════

### BLOCKER 1 — Employee sync collapse 🔴 P0
Status: 🔴 BROKEN
Affects: ALL tenants, not just BFL

Symptom [CONFIRMED-LOG]:
  BFL has 121,753 rows in Compport employee_master.
  After full sync, CompportIQ Employee table has 161 rows.
  synced=123249, skipped=0, errors=0 — sync reports success.
  All AI agents operating on 0.2% of real employee population.

Root cause [CONFIRMED-CODE: inbound-sync.service.ts ~700-707]:
  Three compounding problems:

  Problem A — Candidate list too narrow:
    detectEmployeeIdColumn tests only:
    ['employee_code','employee_id','emp_code','emp_id','id']
    Does NOT query INFORMATION_SCHEMA.KEY_COLUMN_USAGE for
    the actual MySQL PRIMARY KEY constraint.
    BFL's actual PK column name is [NEEDS-VERIFY — run Phase 1].

  Problem B — Fallback chain defeats detection:
    const raw = (row[idStrategy.column] as unknown) ??
                validRow.employee_code ??
                validRow.employee_id ??
                validRow.id;
    If detected column has nulls, chain falls to employee_code.
    BFL's employee_code has only 161 distinct values → collapse.

  Problem C — Zod schema false negative:
    CloudSqlEmployeeRowSchema requires one of:
    employee_id / employee_code / id
    If none exist, Zod still passes (.passthrough()) but
    extraction uses wrong column silently.

Same bug in delta sync [CONFIRMED-CODE]:
  syncEmployeesIncremental uses same Employee.upsert path.
  Fix BOTH simultaneously. Delta runs every 120s.

Fix approach:
  Step 1: Query INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE CONSTRAINT_NAME = 'PRIMARY'
          AND TABLE_SCHEMA = schemaName
          AND TABLE_NAME = tableName
          → get actual PK column FIRST, before any candidate check

  Step 2: Extended candidate list (after PK check):
          employee_id, emp_id, emp_no, staff_id, personnel_id,
          payroll_id, badge_id, employee_number, emp_master_id,
          emp_code, worker_id, person_id, serial_no, pk_id

  Step 3: For each candidate compute distinct/total ratio.
          Accept column where ratio >= 0.95 AND distinct = total.
          Log WARNING if best ratio < 0.95.

  Step 4: Remove fallback chain entirely.
          Use ONLY detected column. Skip null rows. Log first 5.

  Step 5: Store in IntegrationConnector.config:
          { detectedEmployeeIdColumn, idColumnConfidence,
            idColumnDistinct, idColumnTotal, detectedAt }

  Step 6: Delta sync reads stored value. NEVER re-detects.

  Step 7: Store in SyncJob.metadata:
          { detectedIdColumn, idColumnConfidence }

DO NOT PROCEED past this fix until Employee count ≈ 121,753 for BFL.

---

### BLOCKER 2 — BENEFITS_ENCRYPTION_KEY missing 🔴 P0
Status: 🔴 BROKEN
File [CONFIRMED-CODE]: 
  apps/api/src/modules/benefits/services/encryption.service.ts:22-36

Symptom: App generates random AES-256-GCM key on EVERY restart.
Any BenefitDependent.ssnEncrypted written before a restart becomes
permanently unrecoverable. Data loss on every Cloud Run restart.

Fix:
  1. Change startup behavior: THROW if key missing. Never generate.
  2. Generate: openssl rand -hex 32
  3. Store in GCP Secret Manager as BENEFITS_ENCRYPTION_KEY
  4. Mount in infra/terraform/modules/cloudrun/main.tf
     (same pattern as INTEGRATION_ENCRYPTION_KEY)
  5. Add to apps/api/src/config/env.validation.ts as required

---

### BLOCKER 3 — PLATFORM_CONFIG_ENCRYPTION_KEY missing 🔴 P0
Status: 🔴 BROKEN
File [CONFIRMED-CODE]:
  apps/api/src/modules/platform-admin/services/
  platform-config.service.ts:27-40

Symptom: Falls back to hardcoded string
  'platform-config-dev-key-32char!'
This key is committed to the repository. Anyone with repo access
can decrypt all platform_config values including API keys and
connector credentials.

Fix:
  1. Generate: openssl rand -hex 32
  2. Store in GCP Secret Manager as PLATFORM_CONFIG_ENCRYPTION_KEY
  3. Mount in Cloud Run
  4. Re-encrypt all existing platform_config rows that were
     encrypted with the hardcoded key BEFORE deploying new key
  5. THROW on startup if key missing. Never fall back.

---

### BLOCKER 4 — User→Employee link never populated 🔴 P0
Status: 🔴 BROKEN
File [CONFIRMED-CODE]: inbound-sync.service.ts:1542
Comment in code: "skipping employee link for perf"

Symptom: All 123,249 User rows have employeeId = null [CONFIRMED-LOG].
  MANAGER role copilot: "do NOT show data outside their team"
  → relies on User.employeeId. With null: undefined behavior.
  EMPLOYEE self-service: cannot find own record.
  Copilot MANAGER and EMPLOYEE scoping both broken.

Fix: After employee sync AND user sync complete, run linking pass:
  1. Query login_user for (employee_code, email) from Cloud SQL
  2. Build email → employeeCode map
  3. Build employeeCode → PostgreSQL Employee.id map
  4. Batch UPDATE User SET employeeId in chunks of 500
  5. Log link rate — WARN if < 80%
  6. Run at end of full sync AND after delta syncs touching
     employees or users

---

### BLOCKER 5 — Empty passwordHash login vulnerability 🔴 P0
Status: 🔴 BROKEN
File [CONFIRMED-CODE]: inbound-sync.service.ts syncRolesAndPermissions

Symptom: All synced users created with passwordHash: ''
bcryptjs.compare('', '') behavior is implementation-dependent.
123,249 users potentially accessible with empty password.

Fix: In AuthService.login, BEFORE bcryptjs.compare call:
  if (!user.passwordHash || user.passwordHash.trim() === '') {
    throw new UnauthorizedException(
      'This account was provisioned by Compport. ' +
      'Use SSO or contact your administrator to set a password.'
    );
  }

---

### BLOCKER 6 — Compensation data not synced at all ⬜ P0
Status: ⬜ NOT STARTED
[CONFIRMED-SCHEMA]: Employee model has baseSalary, totalComp,
  compaRatio, performanceRating fields in schema.prisma
[NEEDS-VERIFY]: Which Compport tables hold this data per tenant.
  Table names vary: salary_details / ctc_details / comp_details
[NEEDS-VERIFY]: Whether defaultMapping() in inbound-sync.service.ts
  populates these fields or leaves them null

Impact: WITHOUT this:
  - Pay equity analysis runs on empty salary data
  - Budget optimizer has no base to optimize from
  - Attrition predictor has no comp gap factor
  - Copilot cannot answer any compensation questions accurately
  - Simulations have no starting comp data to model from

Discovery query to run for each tenant before fixing:
  SELECT TABLE_NAME, TABLE_ROWS
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = '<tenant_schema>'
  AND TABLE_NAME IN (
    'salary_details','ctc_details','compensation_details',
    'current_ctc','emp_salary','salary_master',
    'revision_history','increment_history','salary_history',
    'comp_history','ctc_history',
    'variable_pay','bonus_details','incentive_details',
    'performance_ratings','appraisal_data','kpi_scores',
    'grade_band','salary_bands','pay_grades',
    'increment_matrix','merit_matrix'
  )
  ORDER BY TABLE_NAME;

Store result in IntegrationConnector.config.availableTables

---

## ═══════════════════════════════════════════
## SECTION 2 — PRODUCT OVERVIEW
## ═══════════════════════════════════════════

CompportIQ is an AI-powered compensation intelligence layer
built on top of Compport — a PHP/MySQL B2B SaaS compensation
platform used by enterprises like BFL, SBI Life, Infosys,
Standard Bank, ADNOC, Novelis.

Each Compport client = one tenant in CompportIQ.
Each tenant has their own MySQL schema in Compport Cloud SQL.
Each tenant is isolated in CompportIQ via PostgreSQL RLS.

Primary data flow:
  Compport Cloud SQL (MySQL, per-tenant schema)
    ↓ inbound-sync.service.ts (pull, every 120s delta + on-demand full)
  CompportIQ PostgreSQL (primary store, RLS-enforced)
    ↓ LangGraph agents (14 agents, Azure OpenAI GPT-4o)
    ↓ NestJS/Fastify API
    ↓ Next.js frontend

Write-back flow (implemented in backend, UI not wired):
  CompportIQ CompRecommendation (human-approved)
    ↓ write-back.service.ts
    ↓ Compport MySQL via parameterized SQL

---

## ═══════════════════════════════════════════
## SECTION 3 — TECH STACK
## ═══════════════════════════════════════════
## All versions confirmed from package.json files.

Layer                | Technology                     | Version
---------------------|--------------------------------|------------------
Runtime              | Node.js                        | ≥20 (alpine)
Package manager      | pnpm                           | 10.29.3
Monorepo build       | Turborepo                      | 2.3.0
Language             | TypeScript                     | 5.9.3
API framework        | NestJS                         | 11.1.14
HTTP adapter         | Fastify                        | 5.7.4
Frontend             | Next.js App Router             | 15.5.12
UI components        | React + Tailwind + shadcn/ui   | 18.x / 4.x
Data fetching        | TanStack React Query           | 5.90.21
State                | Zustand                        | 5.0.11
Validation           | Zod                            | 4.3.6
ORM                  | Prisma                         | 7.4.2
PostgreSQL driver    | pg                             | 8.18.0
MySQL client         | mysql2                         | 3.18.2
Primary DB           | PostgreSQL 16 Cloud SQL        | ENTERPRISE
                     |                                | REGIONAL HA
                     |                                | db-custom-2-8192
                     |                                | 50GB, asia-south1
Queue                | BullMQ                         | 5.68.0
Cache / Queue broker | Redis → GCP Memorystore        | 1GB prod
Agent framework      | LangGraph                      | 1.1.4
LangChain core       | @langchain/core                | 1.1.24
LLM prod             | Azure OpenAI GPT-4o            | 2024-08-01-preview
                     | asia-south1 endpoint           |
                     | 50K TPM quota                  |
LLM dev              | OpenAI GPT-4o                  | —
Vector search        | ⬜ NOT IMPLEMENTED              | JSON arrays only
Auth                 | Passport-JWT + bcryptjs        | —
Logging              | Pino + nestjs-pino             | 10.3.1
Testing              | Vitest + Supertest + Playwright | 4.0.18
Hosting              | GCP Cloud Run                  | asia-south1
IaC                  | Terraform                      | infra/terraform/
CI/CD                | GitHub Actions + WIF           | .github/workflows/

---

## ═══════════════════════════════════════════
## SECTION 4 — MULTI-TENANCY MODEL
## ═══════════════════════════════════════════

Three enforcement layers — ALL THREE must hold for isolation:

LAYER 1 — JWT claim [CONFIRMED-CODE: jwt.strategy.ts:21-28]
  Every request carries tenantId in JWT payload.
  Set at login in auth.service.ts:486-529.
  NEVER re-derive tenantId from request body.
  ALWAYS read from req.user.tenantId.

LAYER 2 — TenantGuard [CONFIRMED-CODE: tenant.guard.ts]
  Validates tenant.isActive = true.
  60-second in-memory cache.
  Applied globally to all non-platform-admin routes.

LAYER 3 — PostgreSQL FORCE RLS [CONFIRMED-CODE: rls-extension.ts]
  SET LOCAL app.current_tenant_id = $1 inside every transaction.
  Even a forged JWT cannot read other tenant data at DB level.

forTenant() — MANDATORY pattern for all tenant data:
  [CONFIRMED-CODE: database.service.ts:62-70]
  await this.db.forTenant(tenantId, async (tx) => {
    // ALL queries here are RLS-scoped to tenantId
    // SET LOCAL means GUC cannot leak across pool connections
  }, { timeout?, maxWait? });

NEVER do this:
  await this.db.client.employee.findMany(...)  // bypasses RLS
  const tenantId = req.body.tenantId           // never trust body

Platform admin bypass [CONFIRMED-CODE: platform-admin.controller.ts]:
  @UseGuards(JwtAuthGuard, PlatformAdminGuard) — no TenantGuard
  Cross-tenant list queries use db.client intentionally
  Per-tenant detail queries MUST still use db.forTenant

RLS tables confirmed [CONFIRMED-CODE: migration 20260227100000
+ 20260402100000]:
  users, employees, sync_jobs, integration_connectors,
  import_jobs, import_ai_analyses, rule_sets, simulation_runs,
  simulation_scenarios, comp_cycles, payroll_runs, audit_logs,
  notifications, field_mappings, webhook_endpoints, benefit_plans,
  benefit_enrollments, enrollment_windows, life_events,
  saved_reports, policy_documents, policy_chunks,
  policy_conversions, compliance_scans, compensation_letters,
  write_back_batches, copilot_conversations + more

⚠️ VERIFY copilot_conversations RLS [NEEDS-VERIFY]:
  Table created in migration 20260306100000.
  RLS rollout was 20260402100000.
  Manually confirm copilot_conversations is in the later migration.
  A conversation leaking across tenants is a critical trust breach.

Tables intentionally WITHOUT RLS:
  tenants           — root table, no tenantId column
  refresh_tokens    — no tenantId, protected via user FK
  platform_config   — system-wide, no tenant scope

---

## ═══════════════════════════════════════════
## SECTION 5 — DATA INGESTION PIPELINE
## ═══════════════════════════════════════════

### 5.1 Overview
Type: Direct MySQL pull (NOT Datastream CDC, NOT Pub/Sub)
Schedule: BullMQ repeatable job, every 120 seconds per tenant
Full sync: On-demand via platform admin UI or API
All ingestion applies to ALL tenants — not BFL-specific.

### 5.2 Entry points [CONFIRMED-CODE]
Full sync:
  POST /api/v1/platform-admin/tenants/:id/sync-full
  → platform-admin.service.ts startTenantFullSync
  → runFullSyncBackground (fire-and-forget, no HTTP wait)
  → UI polls GET .../sync-jobs/:jobId every 3s

Delta sync:
  BullMQ realtime-sync every SYNC_INTERVAL_SECONDS (default 120)
  → sync-scheduler.service.ts
  → inbound-sync.service.ts syncIncremental
  → WHERE timestampCol > lastSyncAt

Roles only:
  POST /api/v1/platform-admin/tenants/:id/sync-roles

### 5.3 Sync sequence — correct order, always
  a. Discover available tables via INFORMATION_SCHEMA
  b. Load lookup maps (manage_* → in-memory Maps, not persisted)
  c. Roles → TenantRole
  d. Pages → TenantPage
  e. Permissions → TenantRolePermission
  f. Employees → Employee (paginated, upsert)   ← BLOCKER 1
  g. Users → User (dedupe by email, batch upsert)
  h. User→Employee linking pass                  ← BLOCKER 4
  i. Manager resolution (second pass after f)    ← broken, auto-fixes
  j. Compensation data sync                      ← BLOCKER 6
  k. Performance data sync                       ← BLOCKER 6

### 5.4 What gets synced — ALL TENANTS

Table availability varies per tenant schema.
NEVER assume a table exists.
ALWAYS check INFORMATION_SCHEMA first.
Store available tables in IntegrationConnector.config.availableTables.

CORE EMPLOYEE IDENTITY
Source (check in this order)   → PG Destination  | Notes
-------------------------------|-----------------|------------------
employee_master                → Employee        | Primary in most
login_user                     → Employee        | Fallback if no master
employees                      → Employee        | Some schemas
login_user                     → User            | Always present

EMPLOYEE FIELDS MAPPING
[CONFIRMED-SCHEMA: Employee model in schema.prisma]
[NEEDS-VERIFY: Which fields defaultMapping() actually populates]
[NEEDS-VERIFY: Which MySQL column maps to which PG field]
Verify by reading:
  inbound-sync.service.ts defaultMapping() function

Known PG Employee fields from schema.prisma:
  employeeCode     ← source PK column (detected per tenant)
  email            ← [NEEDS-VERIFY column name]
  name / firstName / lastName ← [NEEDS-VERIFY column names]
  department       ← [NEEDS-VERIFY, likely via manage_function]
  level            ← [NEEDS-VERIFY, likely via manage_level]
  grade            ← [NEEDS-VERIFY, likely via manage_grade]
  designation      ← [NEEDS-VERIFY, likely via manage_designation]
  location / city  ← [NEEDS-VERIFY, likely via manage_city]
  managerId        ← resolved from manager reference column
  hireDate         ← [NEEDS-VERIFY column name]
  terminationDate  ← [NEEDS-VERIFY column name]
  baseSalary       ← ⬜ NOT SYNCED (BLOCKER 6)
  totalComp        ← ⬜ NOT SYNCED (BLOCKER 6)
  compaRatio       ← ⬜ NOT SYNCED (BLOCKER 6)
  performanceRating← ⬜ NOT SYNCED (BLOCKER 6)
  gender           ← [NEEDS-VERIFY — needed for pay equity]
  currency         ← [NEEDS-VERIFY column name]

LOOKUP TABLES (in-memory during sync, resolve FK ids → names)
manage_function         → Employee.functionName / department
manage_level            → Employee.level
manage_grade            → Employee.grade
manage_designation      → Employee.designation
manage_city             → Employee.city / location
manage_subfunction      → Employee.subFunction
manage_employee_role    → Employee.employeeRole
manage_employee_type    → Employee.employmentType
manage_cost_center      → Employee.costCenter
manage_country          → Employee.country
manage_business_level_1 → Employee.businessUnit L1
manage_business_level_2 → Employee.businessUnit L2
manage_business_level_3 → Employee.businessUnit L3
manage_education        → Employee.education
manage_role             → role label
                          ⚠️ MISSING in BFL schema [CONFIRMED-LOG]
manage_department       → department [NEEDS-VERIFY if present]
manage_band             → band/grade band [NEEDS-VERIFY if present]

Missing lookup tables:
  Log as WARN. Continue sync. Do not fail or stop.

ROLES AND PERMISSIONS [CONFIRMED-LOG: working correctly]
roles            → TenantRole            (19 synced for BFL)
pages            → TenantPage            (209 synced for BFL)
role_permissions → TenantRolePermission  (434 synced for BFL)

COMPENSATION DATA [NEEDS-VERIFY: table names per tenant]
Run discovery query (Section 1, BLOCKER 6) before implementing.
Priority 1 (unblocks most agents):
  salary_details OR ctc_details OR compensation_details OR
  current_ctc OR emp_salary OR salary_master
  → Employee.baseSalary, .totalComp, .currency

Priority 2 (enables trend analysis):
  revision_history OR increment_history OR salary_history OR
  comp_history
  → New CompRevision model:
    { id, tenantId, employeeId, effectiveDate, previousSalary,
      newSalary, changePercent, changeReason, approvedBy,
      cycleId, createdAt }
    [NEEDS-VERIFY: this model does not yet exist in schema.prisma
     — create migration before implementing sync]

Priority 3 (improves AI accuracy):
  performance_ratings OR appraisal_data OR kpi_scores
  → Employee.performanceRating (field exists in schema)

Priority 4 (enables band compliance):
  grade_band OR salary_bands OR pay_grades
  → SalaryBand model (exists in schema.prisma [CONFIRMED-SCHEMA])

PERFORMANCE DATA [NEEDS-VERIFY: table names per tenant]
  performance_ratings / appraisal_data / kpi_scores
  → Employee.performanceRating

### 5.5 Upsert pattern — DO NOT CHANGE THIS
[CONFIRMED-CODE: inbound-sync.service.ts ~718-760]
This pattern was arrived at after fixing transaction timeout
failures. Keep chunk sizes and timeout values.

  BATCH_SIZE = 5000        (rows per SELECT from MySQL)
  UPSERT_TX_CHUNK = 500    (rows per Prisma transaction)
  TX_TIMEOUT = 300_000ms   (5 minutes per chunk transaction)

  await this.db.forTenant(tenantId, async (tx) => {
    for (const { employeeCode, data } of chunk) {
      await tx.employee.upsert({
        where: { tenantId_employeeCode: { tenantId, employeeCode } },
        create: { tenantId, employeeCode, ...data },
        update: data,
      });
    }
  }, { timeout: 300_000, maxWait: 30_000 });

What was tried before and FAILED [CONFIRMED from git history]:
  - Single transaction for 5000 rows → expired transaction error
  - Candidate fallback chain → collapse bug (current blocker)
  - Smart detection without PK query → still collapses

### 5.6 Per-tenant connector config
IntegrationConnector.config must store after first sync:
  {
    schemaName,                    // Compport MySQL schema
    detectedEmployeeIdColumn,      // e.g. 'emp_master_id'
    idColumnConfidence,            // 0.0 - 1.0
    idColumnDistinct,              // count
    idColumnTotal,                 // count
    detectedAt,                    // ISO timestamp
    availableTables,               // from INFORMATION_SCHEMA
    syncedTables,                  // what is actively synced
    timestampColumn,               // for delta sync
    lastFullSyncAt,
    lastDeltaSyncAt
  }

### 5.7 Write-back pipeline [CONFIRMED-CODE: write-back.service.ts]
Fully implemented (841 lines) including:
  - Create batch from approved CompRecommendations
  - Preview (SQL only, no DB contact)
  - Dry-run (connects to MySQL, SELECT validators only)
  - Apply (requires confirmedWithPhrase human gate)
  - Full rollback states (ROLLING_BACK/ROLLED_BACK/ROLLBACK_FAILED)

Status: ⬜ UI not wired
  API routes exist and work. Frontend pages exist as placeholders.
  Wire these pages to the API:
    POST   /api/v1/compport-bridge/write-back/batches
    GET    /api/v1/compport-bridge/write-back/batches/:id
    POST   /api/v1/compport-bridge/write-back/batches/:id/dry-run
    POST   /api/v1/compport-bridge/write-back/batches/:id/apply

### 5.8 BFL-specific verified facts
Compport schema name: 250108_1736335952 [CONFIRMED-LOG]
Primary employee table: employee_master [CONFIRMED-LOG]
Total rows in employee_master: ~121,753 [CONFIRMED-LOG]
Current Employee rows in PG: 161 [CONFIRMED-LOG] ← WRONG
Roles synced: 19 [CONFIRMED-LOG]
Pages synced: 209 [CONFIRMED-LOG]
Permissions synced: 434 [CONFIRMED-LOG]
Users synced: 123,249 [CONFIRMED-LOG]
Manager resolution: resolved=0, unresolved=123,170 [CONFIRMED-LOG]
Missing lookup: manage_role [CONFIRMED-LOG]
Actual employee PK column: [NEEDS-VERIFY — run Phase 1 query]
Compensation table names: [NEEDS-VERIFY — run discovery query]

---

## ═══════════════════════════════════════════
## SECTION 6 — AGENT ARCHITECTURE
## ═══════════════════════════════════════════

All agents: packages/ai/src/graphs/ [CONFIRMED-CODE]
All tools: packages/ai/src/tools/ [CONFIRMED-CODE]
Checkpointer: @langchain/langgraph-checkpoint-postgres
  (prod) / in-memory (dev) [CONFIRMED-CODE: checkpointer.ts]

Agent                | Status | Notes
---------------------|--------|--------------------------------
copilot              | ✅     | SSE streaming, role-gated tools
policy-parser        | ✅     | No HTTP controller, internal
compliance-scanner   | ✅     | FLSA/pay equity/policy violations
anomaly-explainer    | ✅     | Payroll anomaly root cause
attrition-predictor  | ✅     | 6-factor retention risk
budget-optimizer     | ✅     | Multi-scenario allocation
calibration-assistant| ✅     | Calibration session guidance
data-quality         | ✅     | Hygiene issues + fix suggestions
field-mapping        | ✅     | CSV column auto-mapping
letter-generator     | ✅     | Offer/raise/promotion letters
pay-equity           | ✅     | EDGE regression gap analysis
policy-rag           | ✅     | RAG Q&A (⚠️ JSON, not pgvector)
report-builder       | ✅     | NL report generation
simulation           | ✅     | What-if scenario modeling
rule-analysis        | ✅     | Rule set analysis/comparison
echo                 | ✅     | Test/debug only

⚠️ ALL AGENTS are operating on 161/121,753 employees (0.2%)
until BLOCKER 1 is fixed. All agent outputs are unreliable
until employee sync is corrected.

⚠️ ALL AGENTS that use compensation figures (pay equity,
budget optimizer, attrition, simulation) are operating on
EMPTY salary data until BLOCKER 6 is fixed.

Copilot tenant isolation [CONFIRMED-CODE: copilot-tools.ts]:
  db.forTenant() called on every tool method
  System prompt is role-aware per Compport role
  MANAGER: "do NOT show data for employees outside their team"
  EMPLOYEE: "do NOT show other employees' data"
  ⚠️ MANAGER scoping broken — User.employeeId = null (BLOCKER 4)
  DO NOT expose MANAGER role until BLOCKER 4 is fixed

Azure OpenAI config [CONFIRMED-CODE: packages/ai/src/config.ts]:
  Provider: azure (prod) / openai (dev)
  Model: gpt-4o
  Quota: 50K TPM asia-south1
  ⬜ No 429 retry/backoff implemented — add exponential backoff

---

## ═══════════════════════════════════════════
## SECTION 7 — DATABASE SCHEMA
## ═══════════════════════════════════════════
## Source: packages/database/prisma/schema.prisma (2141 lines)
## All models confirmed from schema file.

### 7.1 Key models [CONFIRMED-SCHEMA]

Tenant
  id, name, slug, subdomain, customDomain, logoUrl, primaryColor,
  isActive, compportSchema, plan, settings(Json)
  → Root of all cascade deletes

User
  id, tenantId, email, name, passwordHash, azureAdOid,
  role(String), employeeId(nullable), avatarUrl,
  failedLoginAttempts, lockedUntil, lastLoginAt
  @@unique([tenantId, email])
  ⚠️ employeeId is null for all 123K synced users (BLOCKER 4)

Employee
  id, tenantId, employeeCode, email, name, department, level,
  grade, designation, location, managerId(self-FK SetNull),
  hireDate, terminationDate, currency,
  baseSalary, totalComp, compaRatio,    ← ⬜ NOT SYNCED
  performanceRating,                     ← ⬜ NOT SYNCED
  gender, dateOfBirth,                   ← [NEEDS-VERIFY populated]
  functionType, responsibilityLevel,     ← EDGE pay equity fields
  isPeopleManager, ftePercent,           ← EDGE pay equity fields
  totalCashComp,                         ← EDGE pay equity fields
  jobFamily, salaryBandId, jobLevelId,
  metadata(Json)
  @@unique([tenantId, employeeCode])     ← collapse key (BLOCKER 1)
  @@unique([tenantId, email])

IntegrationConnector
  id, tenantId, name, type(COMPPORT_CLOUDSQL etc),
  status, config(Json), encryptedCredentials,
  credentialIv, credentialTag, lastSyncAt

SyncJob
  id, connectorId, tenantId, direction, entityType,
  status, totalRecords, processedRecords, failedRecords,
  skippedRecords, startedAt, completedAt,
  errorMessage, metadata(Json)

PolicyChunk
  id, documentId, content, embedding(Json @default("[]"))
  ← ⬜ NOT pgvector — in-memory similarity only

WriteBackBatch
  Uses confirmedWithPhrase human gate before apply.
  Supports full rollback states.
  ← ⬜ UI not wired

CopilotConversation / CopilotMessage
  Persistent chat history, tenant+user scoped
  ⚠️ RLS status needs verification (see Section 4)

CompRevision
  ← [NEEDS-VERIFY: does this model exist in schema.prisma?]
  If not, create migration before implementing comp data sync.

### 7.2 Migrations [CONFIRMED-CODE: prisma/migrations/]

Key migrations in order:
  20260212124233  Initial schema
  20260227100000  RLS on 39 tables
  20260303100000  Tenant branding + platform admin
  20260306100000  Copilot conversations
  20260309100000  EDGE pay equity fields on Employee
  20260327100000  RLS auth bypass (enables login flow)
  20260401100000  Dynamic roles/permissions
  20260402100000  RLS on missing tables
  20260402100100  Missing indexes
  20260402100200  Refresh token rotation
  20260402100300  Account lockout
  20260405100000  Security compliance tables
  20260405120000  Platform config table
  20260405130000  Write-back rollback statuses
  20260406100000  Fix user lockout columns
  20260406110000  Missing tenant FK cascades (12 tables)
  20260408100000  Reset admin lockout
  20260408110000  Reset admin password
  20260408120000  Force reset admin

⚠️ Ghost migration in deploy.yml [CONFIRMED-CODE: deploy.yml:132]:
  prisma migrate resolve --rolled-back
    20260409100000_create_missing_connectors 2>/dev/null || true
  This migration folder does NOT exist in the repo.
  The || true silently hides errors on every deploy.
  ACTION: Remove this line from deploy.yml.

### 7.3 pgvector status ⬜ NOT IMPLEMENTED
PolicyChunk.embedding is Json @default("[]").
Similarity search runs in-memory over all chunks — not scalable.

Migration needed:
  CREATE EXTENSION IF NOT EXISTS vector;
  ALTER TABLE policy_chunks ADD COLUMN embedding_vec vector(1536);
  UPDATE policy_chunks SET embedding_vec = embedding::vector
    WHERE embedding != '[]';
  CREATE INDEX CONCURRENTLY policy_chunks_embedding_hnsw
    ON policy_chunks USING hnsw (embedding_vec vector_cosine_ops)
    WITH (m=16, ef_construction=64);

After index verified working:
  Update policy-rag-tools.ts to use:
    ORDER BY embedding_vec <=> $1::vector LIMIT 10
  Drop old Json column.

---

## ═══════════════════════════════════════════
## SECTION 8 — ENVIRONMENT AND CONFIG
## ═══════════════════════════════════════════

Variable                      | Status | Source             | Notes
------------------------------|--------|--------------------|------------------
DATABASE_URL                  | ✅     | Secret Manager     |
REDIS_URL                     | ✅     | Secret Manager     |
JWT_SECRET                    | ✅     | Secret Manager     |
JWT_EXPIRATION                | ⚠️     | Static: 1d         | Change to 15m
NEXTAUTH_SECRET               | ✅     | Secret Manager     |
AZURE_OPENAI_API_KEY          | ✅     | Secret Manager     |
AZURE_OPENAI_ENDPOINT         | ✅     | Secret Manager     |
AZURE_OPENAI_DEPLOYMENT_NAME  | ✅     | Static: gpt-4o     |
AZURE_OPENAI_API_VERSION      | ✅     | Static: 2024-08-01 |
INTEGRATION_ENCRYPTION_KEY    | ✅     | Secret Manager     | Mounted as
                              |        |                    | encryption_key
BENEFITS_ENCRYPTION_KEY       | 🔴     | NOT SET            | BLOCKER 2
PLATFORM_CONFIG_ENCRYPTION_KEY| 🔴     | NOT SET            | BLOCKER 3
PII_ENCRYPTION_KEY            | 🔴     | NOT SET            | Fallback for above
AI_MONTHLY_BUDGET_CENTS       | ⚠️     | Unset (=$50/mo)    | Set to 50000
                              |        |                    | ($500) for enterprise
MYSQL_CA_CERT                 | ✅     | Cloud Run mount    |
MYSQL_CLIENT_CERT             | ✅     | Cloud Run mount    |
MYSQL_CLIENT_KEY              | ✅     | Cloud Run mount    |
DB_HOST / DB_USER / DB_PWD    | ✅     | Secret Manager     |
SYNC_INTERVAL_SECONDS         | ✅     | Unset (=120s)      |
COMPPORT_MODE                 | ✅     | Static: standalone |
NODE_ENV                      | ✅     | Static: production |

To generate and store a missing key:
  openssl rand -hex 32
  gcloud secrets create SECRET_NAME --data-file=- \
    <<< "$(openssl rand -hex 32)"
  Then add mount in infra/terraform/modules/cloudrun/main.tf
  And add to apps/api/src/config/env.validation.ts as required

⚠️ env.validation.ts only validates DATABASE_URL, JWT_SECRET,
REDIS_URL on startup. Encryption keys are validated at
service-instantiation time with warnings — NOT failures.
This is why the app boots clean with missing keys.
FIX: Add all three encryption keys to env.validation.ts as required.

---

## ═══════════════════════════════════════════
## SECTION 9 — GO-LIVE CHECKLIST
## ═══════════════════════════════════════════

### P0 — Cannot ship without these ✋

Employee sync:
  [ ] Run INFORMATION_SCHEMA PK discovery query for BFL
  [ ] Confirm actual employee PK column name (update BFL notes)
  [ ] Fix detectEmployeeIdColumn to query PK constraint first
  [ ] Remove fallback chain from extraction
  [ ] Delta sync uses stored detectedEmployeeIdColumn
  [ ] Employee count in PG ≈ 121,753 for BFL after fix
  [ ] idColumnConfidence >= 0.95 in SyncJob metadata
  [ ] Run discovery query for comp/perf tables (BLOCKER 6)

Encryption:
  [ ] BENEFITS_ENCRYPTION_KEY generated and in Secret Manager
  [ ] BENEFITS_ENCRYPTION_KEY mounted in Cloud Run
  [ ] App throws (not warns) on missing BENEFITS_ENCRYPTION_KEY
  [ ] PLATFORM_CONFIG_ENCRYPTION_KEY generated and set
  [ ] Existing platform_config rows re-encrypted with new key
  [ ] App throws (not warns) on missing PLATFORM_CONFIG key
  [ ] All three encryption keys in env.validation.ts as required

Security:
  [ ] Empty passwordHash check in AuthService.login
  [ ] No user can log in with empty password — test this
  [ ] copilot_conversations RLS confirmed in migration SQL
  [ ] JWT_EXPIRATION changed to 15m
  [ ] Silent refresh (api-client.ts) verified working with 15m TTL

Users:
  [ ] User→Employee linking pass implemented
  [ ] Link rate > 80% for BFL after fix
  [ ] MANAGER role copilot tested with linked users

Deploy pipeline:
  [ ] Ghost migration line removed from deploy.yml:132
  [ ] Deploy runs clean with no swallowed errors

### P1 — Before first client demo

Observability:
  [ ] All .catch(() => {}) replaced with structured logger.error
      Locations: inbound-sync.service.ts:670
                 compport-cloudsql.service.ts:165,209,273,281
                 auth.service.ts:120-130
                 benchmarking/market-data-sync.service.ts:~515
                 apps/web/analytics/simulations/page.tsx:69
                 apps/web/login/page.tsx:72,80
  [ ] /health endpoint checks ingestion last-run per tenant
  [ ] PermissionGuard fallback fires a metric (not just logs)

LLM reliability:
  [ ] Azure OpenAI 429 exponential backoff implemented
      (1s, 2s, 4s, 8s + jitter, max 4 retries)
  [ ] AI_MONTHLY_BUDGET_CENTS set to 50000 in prod

Infrastructure:
  [ ] Cloud Run API max_instance_request_concurrency = 80
  [ ] Cloud Run API memory >= 2048Mi
  [ ] Cloud Run API CPU >= 2000m
  [ ] Cloud Run min_instance_count = 1 for both services

Features:
  [ ] Write-back UI: preview page wired to API
  [ ] Write-back UI: dry-run page wired to API
  [ ] Write-back UI: apply with confirmation phrase wired
  [ ] Platform admin invite: minimum writes to invite_log table

Manager resolution:
  [ ] After BLOCKER 1 fixed, re-run manager resolution
  [ ] Confirm manager column name in employee_master for BFL
      Run: SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME='employee_master'
           AND COLUMN_NAME LIKE '%manager%'
  [ ] resolved count > 100K for BFL

### P2 — First week in production

Vector search:
  [ ] pgvector extension enabled on Cloud SQL PG
  [ ] embedding_vec vector(1536) column added to policy_chunks
  [ ] Existing JSON embeddings backfilled to vector column
  [ ] HNSW index created CONCURRENTLY
  [ ] policy-rag-tools.ts updated to use cosine distance query
  [ ] Old JSON embedding column dropped

Compensation data:
  [ ] Discovery query run for all active tenants
  [ ] Salary/CTC sync implemented for confirmed table names
  [ ] CompRevision model created if not exists
  [ ] Revision history sync implemented
  [ ] Pay equity, budget optimizer, attrition predictor
      re-tested with real compensation data

Testing:
  [ ] E2E Playwright tests added to CI pipeline
  [ ] Integration tests for inbound-sync with real MySQL + PG
  [ ] Test covers non-standard PK column name detection
  [ ] Test covers empty-password login rejection

Resilience:
  [ ] BullMQ dead-letter table for sync jobs (Redis failure)
  [ ] Terraform remote state backend confirmed (GCS bucket)
  [ ] DataScopeService cache invalidation on role change

---

## ═══════════════════════════════════════════
## SECTION 10 — RULES FOR THIS CODEBASE
## ═══════════════════════════════════════════

Every Claude Code session must follow these rules.
They exist because specific approaches have already failed.

### BEFORE WRITING ANY CODE
1. Read this entire CONTEXT.md
2. Read SECTION 1 — ACTIVE BLOCKERS
3. Read the source files you will modify
4. Check the checklist status for your work area
5. If NEEDS-VERIFY items are relevant to your task, verify
   them by reading the file or running the query FIRST

### INGESTION RULES (highest priority)
- NEVER use a hardcoded candidate list as the primary detection
  strategy. ALWAYS query INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  for the PRIMARY KEY constraint first.
- NEVER use ?? fallback chains after detection.
  Use ONLY the detected column. Skip nulls. Log first 5.
- ALWAYS store detectedEmployeeIdColumn in connector config
  after first detection.
- Delta sync MUST read stored column. NEVER re-detect per run.
- ALWAYS run compensation table discovery query for each tenant
  before implementing comp data sync.
- After any sync fix: verify Employee count approaches source
  row count (not just that sync reports success — check PG table).

### DATABASE RULES
- NEVER use this.db.client for tenant-scoped data
- NEVER accept tenantId from request body
- NEVER string-interpolate values into SQL
  Use Prisma or $executeRaw with parameterized values
- Backtick-quote schema and table names in MySQL queries:
  SELECT * FROM \`${schemaName}\`.\`${tableName}\`
  (schemaName comes from connector config, not user input)

### LLM RULES
- NEVER call LLM without the AI cost guard check
- NEVER build LLM context mixing data from multiple tenants
- Assert all retrieved records have same tenantId before LLM call
- ALWAYS implement 429 retry with exponential backoff
- NEVER return compensation figures without source record citation

### CODE QUALITY RULES
- NEVER use .catch(() => {}) — use this.logger.error with context
- NEVER use console.log — use the Pino logger
- NEVER hardcode tenant IDs, schema names, model names, or keys
- NEVER add npm dependencies without stating what they replace
- NEVER leave TODO comments in code — implement or log as blocker
- NEVER generate random encryption keys as a fallback at runtime

### WHAT HAS FAILED — DO NOT RETRY THESE APPROACHES
1. Hardcoded candidate list for employee ID detection
   → Fails for tenants with non-standard PK names

2. Fallback chain (col ?? employee_code ?? employee_id ?? id)
   → Defeats detection. Causes 121K→161 collapse.

3. Single transaction for full 5000-row batch
   → Transaction timeout error. Current 500-row chunks work.

4. Sync-full as long-lived HTTP request
   → Times out. Current fire-and-forget is correct.

5. db.client for platform admin counts
   → FORCE RLS blocks even owner role. Must use forTenant.

6. Random encryption key generation on startup
   → Unrecoverable data after restart. Must throw instead.

### UPDATE THIS FILE WHEN
- Any blocker is resolved → mark ✅ DONE, update checklist
- BFL employee PK column confirmed → update Section 5.8
- Compensation table names confirmed → update Section 5.4
- Any new issue discovered → add to Section 1 or known issues
- Any migration added → add to Section 7.2
- Any env var status changes → update Section 8
- Any agent added or changed → update Section 6
- CompRevision model added → remove [NEEDS-VERIFY] from Section 7

---

## ═══════════════════════════════════════════
## SECTION 11 — PRODUCT FEATURE MAP
## ═══════════════════════════════════════════

### Features live and functional
Feature                   | Needs to work correctly
--------------------------|----------------------------------------
Copilot NL Q&A            | Employee sync + comp data sync
Pay equity EDGE regression | Employee sync + comp data + gender field
Compliance scanning        | Employee sync + comp data
Attrition risk scoring     | Employee sync + comp data + perf data
Budget optimizer           | Employee sync + comp data
Calibration assistant      | Employee sync + cycle data
Letter generator           | Employee sync (names, roles)
Simulation / what-if       | Employee sync + comp data
Policy RAG                 | Policy documents uploaded by tenant
Report builder             | Any synced data
Anomaly explainer          | Payroll runs data (separate from sync)
Rule analysis              | Rule sets defined by tenant
Field mapping              | CSV imports
Data quality               | Any synced data

⚠️ Currently ALL features depending on comp figures are running
on empty fields. Comp data sync (BLOCKER 6) unblocks most agents.

### Missing features — P1 (first release)
Feature                   | What to build
--------------------------|----------------------------------------
Comp data sync            | Sync salary/CTC/revision tables
                          | (BLOCKER 6 — do this first)
Compa-ratio analysis      | Analytics query on baseSalary vs band
                          | midpoint. Employee model has compaRatio
                          | field — needs data.
Pay compression detection | Flag where junior salary >= senior.
                          | Query on managerId + baseSalary.
                          | No new agent needed — analytics query.
Manager recommendation    | Comp cycle view for MANAGER role showing
view                      | team comp vs band vs peers. Requires
                          | BLOCKER 1 + BLOCKER 4 + BLOCKER 6 fixed.
AI rule authoring         | NL input → policy-parser-graph →
                          | structured RuleSet. Graph exists.
                          | Needs: HTTP endpoint + UI wizard
                          | (ai-rule-wizard.tsx component exists
                          | in apps/web/src/components/ —
                          | [NEEDS-VERIFY: is it wired?])
Cycle readiness score     | Pre-cycle checklist powered by
                          | data-quality agent + cycle workflow.
                          | Data quality agent exists — needs
                          | integration with comp cycle start.

### Missing features — P2 (post-launch roadmap)
Feature                   | What it needs
--------------------------|----------------------------------------
Historical trend analysis  | CompRevision model + revision sync
Promotion readiness scoring| Performance data + tenure + comp gap
Offer intelligence         | Market data + salary bands + internal
                          | equity query
DEI analytics beyond gender| Additional dimension fields on Employee
                          | (ethnicity, age band, disability —
                          | [NEEDS-VERIFY: what Compport stores])
Sync-time anomaly flagging | Comp sync + anomaly-explainer integration
Confidence scoring on all  | Source citation on every agent output
agent outputs             | (copilot has it — others do not)
Token usage dashboard      | AiCostGuard metrics → platform admin UI
AI model fallback          | Azure → OpenAI direct on failure
                          | (config.ts has both — just needs
                          | circuit breaker logic)

---

END OF CONTEXT.md.
