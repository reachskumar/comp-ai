# CONTEXT.md — CompportIQ Engineering Ground Truth
#
# Updated: 2026-04-13
# Source: Full codebase audit + 3-day production stabilization session
#
# ════════════════════════════════════════════════════════════
# EVERY Claude Code session MUST read this file before coding.
# Update this file whenever architecture or status changes.
# ════════════════════════════════════════════════════════════

---

## SECTION 1 — CURRENT STATE (2026-04-13)

### Infrastructure — ALL in `compportiq` GCP project

| Resource | Details |
|---|---|
| **GKE Cluster** | `compportiq-prod-cluster`, asia-south1, regional, 2 node pools |
| **Default Pool** | e2-standard-4 (4 vCPU, 16GB), 2-10 nodes, API + Web + Workers |
| **Worker Pool** | e2-standard-8, spot instances, currently disabled (using default) |
| **PostgreSQL** | `compportiq-gke-postgres`, 10.203.32.2, PG 16, ENTERPRISE, REGIONAL HA |
| **Redis** | `compportiq-gke-redis`, 10.241.79.227, 1GB basic |
| **Cloud NAT** | `gke-nat` on `gke-router` for external MySQL egress |
| **Static IP** | `compportiq-gke-ip` = 34.120.125.227 |
| **DNS** | compportiq.ai + *.compportiq.ai → 34.120.125.227 |
| **TLS** | GKE Managed Certificate (compportiq.ai + bfl.compportiq.ai) |

### Kubernetes Workloads (namespace: compportiq)

| Workload | Replicas | Status |
|---|---|---|
| API (NestJS) | 3, HPA 3-20 | ✅ Running, health OK |
| Web (Next.js) | 2, HPA 2-10 | ✅ Running |
| Sync Workers | 2 | ✅ Running |
| Prometheus | 1 | ✅ Running |
| Grafana | 1 | ✅ Running |
| Alertmanager | 1 | ✅ Running |

### Database Connections

| DB | Host | Access Method |
|---|---|---|
| CompportIQ PostgreSQL | 10.203.32.2:5432 | Direct private IP (same VPC) |
| Redis | 10.241.79.227:6379 | Direct private IP (same VPC) |
| Compport MySQL (UAT) | 34.14.218.154:3306 | Public IP via Cloud NAT |

### Compport MySQL Details
- Instance: `uat-db` in `prj-compport-nonprod-service`
- This is UAT/non-production. For go-live, switch to production instance.
- Production instances are in `prj-compport-prod-service`:
  - `saas-prd-to-as-prod` (db-custom-16-65536) — main production
  - `as1-prod-database` (db-custom-12-16384)
- Switching = update `DB_HOST` + `DB_USER` + `DB_PWD` in K8s secret

---

## SECTION 2 — RESOLVED BLOCKERS

All 6 P0 blockers from the original audit are resolved:

### BLOCKER 1 — Employee sync ✅ RESOLVED
- **Was**: 121,753 rows → 161 in PG (99.9% data loss)
- **Fix**: PK-first detection via INFORMATION_SCHEMA.KEY_COLUMN_USAGE, 16-column candidate list, no fallback chain, per-row recovery, owner-aware email dedupe, stale pruning
- **Result**: 123,249/123,249 (100%), 0 errors, 155 stale rows pruned
- **BFL**: employee_master is EMPTY, data lives in `login_user` (PK: `id`, confidence: 1.000)
- **Commits**: f38704a, abf5821, f61475c, 7e2c83e, e0624be

### BLOCKER 2 — BENEFITS_ENCRYPTION_KEY ✅ RESOLVED
- Secret provisioned in GCP Secret Manager, mounted on GKE
- App throws (not warns) if missing in production

### BLOCKER 3 — PLATFORM_CONFIG_ENCRYPTION_KEY ✅ RESOLVED
- Same treatment as BLOCKER 2. Hardcoded dev key removed.

### BLOCKER 4 — User→Employee linking ✅ RESOLVED
- `linkUsersToEmployees()` runs after every full sync
- Dedupes by both email AND employeeId, bulk raw SQL UPDATE

### BLOCKER 5 — Empty passwordHash ✅ RESOLVED
- AuthService.login rejects empty/whitespace passwordHash before bcrypt

### BLOCKER 6 — Compensation data ✅ RESOLVED
- Agents read directly from Compport MySQL via Redis cache
- TenantSchemaCatalog: 345 tables cataloged for BFL
- CompportQueryCacheService: Redis cache (5 min TTL) → MySQL fallback
- 3 copilot tools: list_compport_tables, describe_compport_table, query_compport_table

---

## SECTION 3 — MULTI-TENANCY

Three enforcement layers — ALL THREE must hold:

1. **JWT claim** `tenantId` set at login (auth.service.ts:486-529)
2. **TenantGuard** validates tenant.isActive (60s cache)
3. **PostgreSQL FORCE RLS** via `forTenant()` → `SET LOCAL app.current_tenant_id`

```typescript
// MANDATORY for all tenant data:
await this.db.forTenant(tenantId, (tx) => { ... });

// NEVER:
await this.db.client.employee.findMany(...); // bypasses RLS
```

Platform admin: `@UseGuards(JwtAuthGuard, PlatformAdminGuard)` — no TenantGuard.
Cross-tenant lists use `db.client` intentionally. Per-tenant details use `db.forTenant`.

---

## SECTION 4 — DATA INGESTION

### Sync Pipeline
```
POST /api/v1/platform-admin/tenants/:id/sync-full
  → Phase 1 (roles): roles → pages → permissions → 123K users
  → Phase 2 (employees): detect PK → upsert → prune stale → link users
  → Phase 3 (catalog): discover all tables → persist to TenantSchemaCatalog
```

### Agent Data Access (no mirror/copy)
```
Agent tool call → Redis cache lookup (5ms hit) → MySQL fallback (100ms miss)
  - list_compport_tables: reads TenantSchemaCatalog
  - describe_compport_table: reads catalog metadata + sample row
  - query_compport_table: parameterized SELECT via CompportQueryCacheService
  - Cache invalidation: after every sync (full + delta)
```

### Upsert Pattern (DO NOT CHANGE)
```
BATCH_SIZE = 5000        (rows per SELECT from MySQL)
UPSERT_TX_CHUNK = 500    (rows per Prisma transaction)
TX_TIMEOUT = 300_000ms   (5 minutes per chunk)
Per-row recovery on chunk failure (no 499-row collateral damage)
```

### Auto-Onboarding
- `createTenant()` with `compportSchema` → auto-triggers `startTenantFullSync()`
- `onboardFromCompport()` → role sync (sync) + full sync (async background)

---

## SECTION 5 — AI AGENTS (16)

All in `packages/ai/src/graphs/`. All use Azure OpenAI GPT-4o.
All query data via `db.forTenant()` — tenant-isolated.

| Agent | File | Key Feature |
|---|---|---|
| Copilot | copilot-graph.ts | SSE streaming, role-aware, 15+ tools |
| Rules Orchestrator | rules-orchestrator-graph.ts | 6 nodes: parse/validate/explain/simulate/apply |
| Policy Parser | rules/graphs/policy-parser-graph.ts | 5-node: classify/extract/map/validate/calibrate |
| + 13 others | See packages/ai/src/graphs/ | All working |

### Copilot System Prompt Rules
- MANDATORY charts for comparative data (bar for salary/dept, pie for headcount)
- INR currency: ₹ with lakhs/crores notation
- NEVER expose table names, column names, or internal IDs
- Top 12 items per chart, sorted descending
- Insights paragraph after every chart
- Action suggestions (drill/export/compare) at end

### LLM Config
- Provider: `azure` (prod), `openai` (dev)
- Model: `gpt-4o`, API version `2024-08-01-preview`
- Max retries: 6 (exponential backoff ~63s total)
- 429 errors show "AI service temporarily busy" (not stack trace)

---

## SECTION 6 — DATABASE SCHEMA

Source: `packages/database/prisma/schema.prisma` (2200+ lines)

### Key Models
- **Tenant**: root of all cascades, compportSchema field
- **User**: @@unique([tenantId, email]), role is String (Compport role ID or PLATFORM_ADMIN)
- **Employee**: @@unique([tenantId, employeeCode]), 150+ fields
- **TenantSchemaCatalog**: per-table metadata from Compport discovery
- **TenantDataMirrorState**: mirror sync tracking (legacy, being deprecated)
- **SyncJob**: sync progress + metadata (phase, detectedIdColumn, counts)
- **CopilotConversation / CopilotMessage**: chat persistence
- **60+ other models**: rules, cycles, payroll, benefits, compliance, equity, etc.

### Migrations (28 total)
Latest: `20260411150000_universal_schema_catalog`
Previous: `20260411140000_drop_employee_email_unique`

---

## SECTION 7 — ENVIRONMENT VARIABLES

### Required in Production
| Variable | Source | Notes |
|---|---|---|
| DATABASE_URL | K8s Secret | PG at 10.203.32.2 |
| REDIS_URL | K8s Secret | Redis at 10.241.79.227 |
| JWT_SECRET | K8s Secret | ≥64 chars |
| BENEFITS_ENCRYPTION_KEY | K8s Secret | ≥32 chars, app throws if missing |
| PLATFORM_CONFIG_ENCRYPTION_KEY | K8s Secret | ≥32 chars, app throws if missing |
| INTEGRATION_ENCRYPTION_KEY | K8s Secret | ≥32 chars |
| AZURE_OPENAI_API_KEY | K8s Secret | Azure OpenAI |
| AZURE_OPENAI_ENDPOINT | K8s Secret | Azure OpenAI |
| DB_HOST | K8s Secret | 34.14.218.154 (UAT MySQL) |
| DB_USER / DB_PWD | K8s Secret | Compport MySQL credentials |

### Static (set in deployment YAML)
NODE_ENV=production, API_PORT=4000, AI_PROVIDER=azure,
COMPPORT_MODE=standalone, LOG_LEVEL=info, SHUTDOWN_TIMEOUT=30000

---

## SECTION 8 — RULES FOR THIS CODEBASE

### NEVER do these:
- `this.db.client` for tenant-scoped data (bypasses RLS)
- `tenantId` from request body (always from JWT)
- `??` fallback chains in employee ID extraction
- `.catch(() => {})` — use `this.logger.error`
- `console.log` — use Pino logger
- Hardcode tenant IDs, schema names, or encryption keys
- Generate random encryption keys at runtime
- Single transaction for 5000+ row batches (use 500-row chunks)
- Long-lived HTTP for sync (use fire-and-forget + polling)

### ALWAYS do these:
- Query INFORMATION_SCHEMA.KEY_COLUMN_USAGE for PK detection first
- Store detected id column in IntegrationConnector.config
- Use `forTenant()` for all tenant-scoped queries
- Use charts for comparative data (bar/pie/line)
- Format Indian currency as ₹ with lakhs/crores
- Per-row recovery on batch failures
- Cache invalidation after every sync

---

## SECTION 9 — REMAINING WORK

### P0 (before go-live)
- [ ] Switch from UAT MySQL to production MySQL
- [ ] Update CI/CD (GitHub Actions) to deploy to GKE instead of Cloud Run
- [ ] TLS certificate: verify Active status
- [ ] Run full sync for BFL on GKE (new empty PG needs data)
- [ ] Verify copilot works end-to-end on GKE

### P1 (first week)
- [ ] Decommission Cloud Run services
- [ ] Decommission old resources in compportiq-ai project
- [ ] Move worker pool to spot instances
- [ ] Set up Grafana dashboards for API latency, sync throughput, AI token usage
- [ ] Configure Alertmanager → Slack integration
- [ ] pgvector for Policy RAG (currently JSON embeddings)

### P2 (roadmap)
- [ ] Claude Sonnet 4 for copilot (better tool-calling, higher quota)
- [ ] Historical trend analysis (CompRevision model)
- [ ] Write-back UI wiring (API exists, frontend placeholder)
- [ ] Token usage dashboard in platform admin
- [ ] AI model fallback (Azure → OpenAI on failure)

---

END OF CONTEXT.md
