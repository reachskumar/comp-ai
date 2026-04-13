# CONTEXT.md — CompportIQ Engineering Ground Truth
#
# Updated: 2026-04-13 (end of 3-day session)
# Source: Full codebase audit + production stabilization + GKE migration
#
# ════════════════════════════════════════════════════════════
# EVERY Claude Code session MUST read this file before coding.
# Update this file whenever architecture or status changes.
# ════════════════════════════════════════════════════════════
#
# NEXT SESSION STARTS HERE:
# The GKE cluster is live but the new PostgreSQL is EMPTY.
# Cloud Run is still serving the old PG with all the data.
# Items 1-5 below are the immediate tasks to complete the migration.
# ════════════════════════════════════════════════════════════

---

## SECTION 0 — WHAT TO DO NEXT (START HERE)

### Immediate tasks (in order, ~1 hour total):

1. **Verify TLS cert is Active**
   ```bash
   export PATH="$PATH:/opt/homebrew/share/google-cloud-sdk/bin"
   export USE_GKE_GCLOUD_AUTH_PLUGIN=True
   kubectl get managedcertificate -n compportiq
   ```
   If still Provisioning after 24h, check DNS + cert events.
   If Active, HTTPS is working: `curl https://compportiq.ai/health`

2. **Seed BFL tenant + platform admin on new PG**
   The new GKE PostgreSQL (10.203.32.2) has the schema (all 28
   migrations applied) but NO data. Need to:
   - Create platform tenant + admin user (seed-prod.ts already ran,
     admin@compportiq.ai exists)
   - Create BFL tenant with compportSchema='250108_1736335952'
   - This can be done via the platform admin API on GKE

3. **Run full sync for BFL on GKE**
   Once BFL tenant exists on the new PG, click Sync All Data.
   This will: sync employees (123K) + roles + users + catalog.
   The agents will then have data to work with on GKE.

4. **Update CI/CD pipeline**
   `.github/workflows/deploy.yml` currently deploys to Cloud Run.
   Change to deploy to GKE:
   ```yaml
   # Replace Cloud Run deploy steps with:
   - name: Deploy to GKE
     run: |
       gcloud container clusters get-credentials compportiq-prod-cluster \
         --region asia-south1 --project compportiq
       kubectl set image deployment/api -n compportiq \
         api=$IMAGE_TAG
       kubectl set image deployment/web -n compportiq \
         web=$WEB_IMAGE_TAG
       kubectl set image deployment/sync-worker -n compportiq \
         sync-worker=$IMAGE_TAG
       kubectl rollout status deployment/api -n compportiq --timeout=120s
   ```

5. **Switch MySQL from UAT to production** (when ready for go-live)
   Current: `uat-db` in `prj-compport-nonprod-service` (34.14.218.154)
   Production: `saas-prd-to-as-prod` in `prj-compport-prod-service`
   Steps:
   - Get production MySQL public IP (or enable it)
   - Whitelist GKE NAT IPs (34.14.154.4, 34.93.151.104) on prod instance
   - Update K8s secret: DB_HOST, DB_USER, DB_PWD
   - Restart API + sync-worker pods

---

## SECTION 1 — CURRENT INFRASTRUCTURE

### Everything in `compportiq` GCP project

| Resource | Name | IP/Endpoint | Status |
|---|---|---|---|
| **GKE Cluster** | compportiq-prod-cluster | 34.93.156.246 (control plane) | ✅ Running |
| **GKE Ingress** | compportiq-ingress | 34.120.125.227 (static IP) | ✅ Serving |
| **PostgreSQL** | compportiq-gke-postgres | 10.203.32.2:5432 | ✅ Running (EMPTY — needs data) |
| **Redis** | compportiq-gke-redis | 10.241.79.227:6379 | ✅ Connected |
| **Compport MySQL** | uat-db (UAT, nonprod) | 34.14.218.154:3306 | ✅ Connected via Cloud NAT |
| **Cloud NAT** | gke-nat on gke-router | NAT IPs: 34.14.154.4, 34.93.151.104 | ✅ Active |
| **TLS Cert** | compportiq-cert | compportiq.ai + bfl.compportiq.ai | ⏳ Provisioning |
| **DNS** | compportiq.ai, *.compportiq.ai | → 34.120.125.227 | ✅ Propagated |
| **VPC** | compportiq-prod-gke-vpc | 10.100.0.0/20 (nodes), 10.104.0.0/14 (pods) | ✅ |
| **VPC Peering** | gke-to-existing | → compportiq-ai VPC | ✅ Active (routes work for MySQL, NOT for Cloud SQL) |

### Kubernetes Workloads (namespace: compportiq)

| Workload | Pods | Image | Health |
|---|---|---|---|
| API | 3 (HPA 3-20) | api:latest | ✅ database:connected, redis:connected |
| Web | 2 (HPA 2-10) | web:latest | ✅ /login returns 200 |
| Sync Workers | 2 | api:latest (same image) | ✅ Running |

### Monitoring (namespace: monitoring)
- Prometheus: scraping /metrics from API pods
- Grafana: admin password = CompportIQ2026!
- Alertmanager: configured, needs Slack webhook

### Cloud Run (OLD — still running, will decommission)
- compportiq-prod-api → points to OLD PG in compportiq-ai (HAS data)
- compportiq-prod-web → same
- DNS NO LONGER points here (cutover done)
- Keep running until GKE is fully verified with data

### Old Resources in `compportiq-ai` project (to decommission)
- VPC: compportiq-prod-vpc (10.0.0.0/20 + 10.0.16.0/20)
- Cloud SQL PG: compportiq-prod-postgres (10.201.1.2) — HAS all the data
- Cloud Run services (no longer receiving DNS traffic)

---

## SECTION 2 — RESOLVED BLOCKERS (all 6 fixed)

| # | Blocker | Status | Key commits |
|---|---|---|---|
| 1 | Employee sync collapse (121K → 161) | ✅ 123,249/123,249 | f38704a, abf5821 |
| 2 | BENEFITS_ENCRYPTION_KEY missing | ✅ Provisioned, throws on missing | 982e649 |
| 3 | PLATFORM_CONFIG_ENCRYPTION_KEY | ✅ Same treatment | 982e649 |
| 4 | User→Employee linking | ✅ Runs after every sync | 982e649, dad1ef6 |
| 5 | Empty passwordHash login | ✅ Rejected before bcrypt | 982e649 |
| 6 | Compensation data not synced | ✅ Agents read MySQL directly via cache | 0f7abff, 15dbf8b |

---

## SECTION 3 — MULTI-TENANCY (3 layers)

1. **JWT claim**: `tenantId` in every token
2. **TenantGuard**: validates active, 60s cache
3. **FORCE RLS**: `SET LOCAL app.current_tenant_id` via `forTenant()`

```typescript
// ALWAYS: await this.db.forTenant(tenantId, (tx) => { ... });
// NEVER:  await this.db.client.employee.findMany();
```

---

## SECTION 4 — DATA ARCHITECTURE

### Typed Models (PostgreSQL, RLS-enforced)
Employee, User, TenantRole, TenantPage, TenantRolePermission,
SyncJob, CopilotConversation, CompCycle, PayrollRun, etc.
- Synced from Compport MySQL via full sync + 2-min delta
- Used for dashboard, fast indexed queries, auth

### Agent Data Access (Redis cache → MySQL direct)
- TenantSchemaCatalog: metadata for all 345 Compport tables
- CompportQueryCacheService: Redis (5 min TTL) → MySQL fallback
- 3 copilot tools: list_compport_tables, describe_compport_table, query_compport_table
- NO mirror/copy — agents read LIVE data from Compport
- Cache invalidated after every sync run

### Sync Flow
```
Full sync (on-demand via platform admin):
  Phase 1: roles → pages → permissions → users (~5 min)
  Phase 2: employees → prune stale → link users (~12 min)
  Phase 3: catalog all tables → persist metadata (~10 sec)

Delta sync (every 2 min via BullMQ):
  WHERE timestampCol > lastSyncAt → upsert changed records
  Cache invalidated after completion
```

---

## SECTION 5 — AI AGENTS (16)

All in `packages/ai/src/graphs/`. All use Azure OpenAI GPT-4o.
Max retries: 6. 429 errors show user-friendly message.

Copilot, Rules Orchestrator, Policy Parser, Compliance Scanner,
Anomaly Explainer, Attrition Predictor, Budget Optimizer,
Calibration Assistant, Data Quality, Field Mapping, Letter Generator,
Pay Equity, Policy RAG, Report Builder, Simulation, Rule Analysis

### Copilot Prompt Rules
- MANDATORY charts for comparative data
- INR currency (₹ with lakhs/crores)
- NEVER expose table names or column names
- Top 12 items per chart, sorted descending
- Insights paragraph + action suggestions after every response

### Frontend Chart Post-Processing
Charts are post-processed in `parseChartBlock()` regardless of LLM output:
- Sort descending by primary Y key
- Limit to 12 items
- Truncate labels to 20 chars
- Y-axis: Cr/L/K notation
- Tooltip: ₹ with Indian locale

---

## SECTION 6 — ENVIRONMENT (GKE)

### K8s Secrets (namespace: compportiq)

**api-secrets:**
DATABASE_URL, REDIS_URL, JWT_SECRET, INTEGRATION_ENCRYPTION_KEY,
BENEFITS_ENCRYPTION_KEY, PLATFORM_CONFIG_ENCRYPTION_KEY,
AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT,
DB_HOST (34.14.218.154), DB_USER, DB_PWD

**web-secrets:**
NEXTAUTH_SECRET, NEXT_PUBLIC_API_URL

### Static Env Vars (in deployment YAML)
NODE_ENV=production, API_PORT=4000, AI_PROVIDER=azure,
COMPPORT_MODE=standalone, LOG_LEVEL=info, SHUTDOWN_TIMEOUT=30000,
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o, AZURE_OPENAI_API_VERSION=2024-08-01-preview

---

## SECTION 7 — CODEBASE RULES

### NEVER:
- `this.db.client` for tenant data (bypasses RLS)
- `tenantId` from request body
- `??` fallback chains in ID extraction
- `.catch(() => {})` — use `this.logger.error`
- Hardcode tenant IDs, schema names, keys
- Random encryption keys at runtime
- Single transaction for 5000+ rows

### ALWAYS:
- `INFORMATION_SCHEMA.KEY_COLUMN_USAGE` for PK detection
- Store detected column in `IntegrationConnector.config`
- `forTenant()` for all tenant queries
- Charts for comparative data
- ₹ currency for Indian companies
- Per-row recovery on batch failures
- Cache invalidation after sync

### WHAT HAS FAILED — DO NOT RETRY:
1. Hardcoded candidate list for employee ID → collapses
2. `??` fallback chain → 121K→161 collapse
3. Single transaction 5000 rows → timeout
4. Long-lived HTTP sync → Cloud Run 900s timeout
5. `db.client` for platform admin counts → RLS blocks
6. Random encryption keys → data loss on restart
7. Mirror sync (copy 5.4M rows to PG) → type-mapping bugs, stale data
8. Cross-project VPC for Cloud SQL → private services don't route transitively

---

## SECTION 8 — COMPPORT MYSQL INSTANCES

### UAT (current — for development/testing)
- Instance: `uat-db`
- Project: `prj-compport-nonprod-service`
- Public IP: 34.14.218.154
- GKE NAT IPs whitelisted: 34.14.154.4, 34.93.151.104
- Credentials: DB_USER-uat-db, DB_PWD-uat-db secrets in compportiq project

### Production (for go-live — NOT yet connected)
- Instance: `saas-prd-to-as-prod` (db-custom-16-65536, 16 vCPU, 64GB)
- Project: `prj-compport-prod-service`
- IP: 10.76.0.17 (private only — needs public IP enabled or VPN)
- Also: `as1-prod-database` (db-custom-12-16384)

### Switching to Production
1. Enable public IP on prod MySQL (or set up VPN)
2. Whitelist GKE NAT IPs
3. Get prod credentials
4. Update K8s api-secrets: DB_HOST, DB_USER, DB_PWD
5. Restart API + sync-worker deployments

---

## SECTION 9 — FULL REMAINING CHECKLIST

### P0 — Before customer access (~1 hour)
- [ ] Verify TLS cert is Active
- [ ] Seed BFL tenant on new GKE PostgreSQL
- [ ] Run full sync for BFL on GKE
- [ ] Verify copilot answers real questions on GKE
- [ ] Update CI/CD to deploy to GKE

### P1 — First week
- [ ] Switch MySQL UAT → production
- [ ] Decommission Cloud Run services
- [ ] Decommission compportiq-ai project resources
- [ ] Grafana dashboards (latency, throughput, tokens)
- [ ] Alertmanager → Slack webhook
- [ ] Move sync workers to spot node pool
- [ ] pgvector for Policy RAG

### P2 — Roadmap
- [ ] Claude Sonnet 4 for copilot
- [ ] Write-back UI wiring
- [ ] Historical trend analysis (CompRevision model)
- [ ] Token usage dashboard
- [ ] AI model fallback (Azure → OpenAI)
- [ ] E2E tests in CI

---

END OF CONTEXT.md
