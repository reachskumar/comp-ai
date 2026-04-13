# CompportIQ — AI-Powered Compensation Intelligence Platform

CompportIQ is an AI layer built on top of [Compport](https://compport.com), a B2B SaaS compensation management platform serving 250+ enterprise customers (BFL, SBI Life, Infosys, Standard Bank, ADNOC, Novelis).

Each Compport customer = one tenant in CompportIQ. The platform syncs data from Compport's MySQL database, applies 16 AI agents for analysis, and provides an intelligent copilot for HR professionals.

## Architecture

```
                         ┌─────────────────────────────────────────────┐
                         │         GKE Cluster (asia-south1)           │
                         │         compportiq GCP project              │
                         │                                             │
  compportiq.ai ────────▶│  ┌─────────┐  ┌─────────┐  ┌────────────┐ │
  *.compportiq.ai        │  │ API ×3  │  │ Web ×2  │  │ Workers ×2 │ │
  (34.120.125.227)       │  │ NestJS  │  │ Next.js │  │ BullMQ     │ │
                         │  └────┬────┘  └─────────┘  └──────┬─────┘ │
                         │       │                            │       │
                         │  ┌────▼────────────────────────────▼────┐  │
                         │  │         Redis (10.241.79.227)        │  │
                         │  │    Query Cache + Job Queue           │  │
                         │  └─────────────────────────────────────┘  │
                         │       │                                    │
                         │  ┌────▼──────────────────────────────┐    │
                         │  │  PostgreSQL 16 (10.203.32.2)      │    │
                         │  │  60+ models, RLS, 28 migrations   │    │
                         │  └───────────────────────────────────┘    │
                         │                                             │
                         │  ┌─────────────────────────────────────┐   │
                         │  │  Prometheus + Grafana + Alertmanager │   │
                         │  └─────────────────────────────────────┘   │
                         └───────────────────┬─────────────────────────┘
                                             │ Cloud NAT
                                             ▼
                         ┌─────────────────────────────────────────────┐
                         │    Compport MySQL (34.14.218.154)            │
                         │    345 tables per tenant, 5.4M+ rows        │
                         │    Agents query via Redis cache (5 min TTL)  │
                         └─────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js (Alpine) | ≥20 |
| Package Manager | pnpm | 10.29.3 |
| Build | Turborepo | 2.3.0 |
| Language | TypeScript | 5.9.3 |
| API Framework | NestJS + Fastify | 11.1.14 / 5.7.4 |
| Frontend | Next.js + React + Tailwind + shadcn/ui | 15.5.12 / 18.x / 4.x |
| State / Data | TanStack React Query + Zustand | 5.90.21 / 5.0.11 |
| ORM | Prisma | 7.4.2 |
| Primary DB | PostgreSQL 16 (Cloud SQL ENTERPRISE, REGIONAL HA) | 50GB SSD |
| Secondary DB | MySQL 8.0 (Compport) | mysql2 3.18.2 |
| Queue | BullMQ + ioredis | 5.68.0 / 5.9.2 |
| AI Framework | LangGraph + @langchain/core + @langchain/openai | 1.1.4 / 1.1.24 / 1.2.7 |
| LLM (prod) | Azure OpenAI GPT-4o | 2024-08-01-preview |
| LLM (dev) | OpenAI GPT-4o | — |
| Auth | JWT + Passport + bcryptjs + CSRF | — |
| Logging | Pino + nestjs-pino | 10.3.1 |
| Testing | Vitest + Supertest + Playwright | 4.0.18 / 7.2.2 / 1.58.2 |
| Hosting | GKE (Kubernetes) | asia-south1 |
| Monitoring | Prometheus + Grafana + Alertmanager | kube-prometheus-stack |
| CI/CD | GitHub Actions + Workload Identity Federation | — |
| IaC | Terraform | 1.5.7 |

## Project Structure

```
comp-ai/
├── apps/
│   ├── api/                    # NestJS REST API (30+ modules)
│   │   ├── src/
│   │   │   ├── auth/           # JWT + Passport + CSRF + account lockout
│   │   │   ├── common/         # Guards, middleware, interceptors
│   │   │   ├── database/       # Prisma client + forTenant() RLS wrapper
│   │   │   ├── modules/
│   │   │   │   ├── compport-bridge/  # MySQL sync + query cache + write-back
│   │   │   │   ├── copilot/          # AI Copilot (SSE streaming)
│   │   │   │   ├── platform-admin/   # Tenant management + onboarding
│   │   │   │   ├── rules/            # Rules engine + AI wizard + CSV upload
│   │   │   │   ├── cycle/            # Comp cycles + calibration + budget
│   │   │   │   ├── payroll/          # Payroll + anomaly detection
│   │   │   │   ├── analytics/        # Pay equity + simulations
│   │   │   │   └── ...              # benefits, compliance, equity, etc.
│   │   │   └── main.ts
│   │   └── Dockerfile
│   └── web/                    # Next.js 15 (49 pages)
│       ├── src/app/            # App Router pages
│       ├── src/components/     # Charts, copilot panel, sync banner
│       ├── src/hooks/          # React Query hooks
│       └── Dockerfile
├── packages/
│   ├── ai/                     # 16 LangGraph agents + tools
│   │   └── src/graphs/         # copilot, rules-orchestrator, compliance, etc.
│   ├── database/               # Prisma schema (2200+ lines, 60+ models)
│   │   └── prisma/migrations/  # 28 migrations with RLS policies
│   ├── shared/                 # Rules engine, data hygiene, encryption
│   └── ui/                     # Shared UI components
├── infra/
│   ├── terraform/modules/      # gke, cloudsql, memorystore, vpc, secrets
│   └── k8s/                    # K8s manifests + monitoring
├── context.md                  # Engineering ground truth
└── README.md
```

## AI Agents (16)

| Agent | Purpose |
|---|---|
| **Copilot** | Conversational Q&A with tool-calling, role-aware prompts, SSE streaming |
| **Rules Orchestrator** | Full rules lifecycle: parse → validate → explain → simulate → apply |
| **Policy Parser** | PDF/text → structured rules (5-node LangGraph pipeline) |
| **Compliance Scanner** | FLSA, pay equity, policy violation detection |
| **Anomaly Explainer** | Payroll anomaly root-cause analysis |
| **Attrition Predictor** | 6-factor retention risk scoring |
| **Budget Optimizer** | Multi-scenario budget allocation |
| **Calibration Assistant** | Calibration session guidance |
| **Data Quality** | Data hygiene audit + fix suggestions |
| **Field Mapping** | CSV/Excel column auto-mapping |
| **Letter Generator** | Offer/raise/promotion/bonus letter generation |
| **Pay Equity** | EDGE regression gap analysis |
| **Policy RAG** | Retrieval-augmented policy Q&A |
| **Report Builder** | Natural language compensation report generation |
| **Simulation** | What-if scenario modeling |
| **Rule Analysis** | Rule set analysis and comparison |

## Multi-Tenancy (3 layers)

1. **JWT claim**: `tenantId` in every token
2. **TenantGuard**: validates tenant is active (60s cache)
3. **PostgreSQL FORCE RLS**: `SET LOCAL app.current_tenant_id` via `forTenant()`

```typescript
// ALWAYS:
await this.db.forTenant(tenantId, (tx) => tx.employee.findMany());

// NEVER:
await this.db.client.employee.findMany(); // bypasses RLS
```

## Data Flow

```
Compport MySQL (per-tenant schema)
  ↓ Full sync: employees, users, roles, pages, permissions (on-demand)
  ↓ Delta sync: every 2 minutes via BullMQ (changed records only)
CompportIQ PostgreSQL (typed Prisma models + RLS)

Compport MySQL (same)
  ↓ Agent tool queries via Redis cache (5 min TTL, event-driven invalidation)
AI Copilot → charts + insights + export (CSV/PDF)
```

## Quick Start

```bash
# Prerequisites: Node 20+, pnpm 10+, Docker
docker compose up -d          # PostgreSQL + Redis
pnpm install
pnpm --filter @compensation/database exec prisma migrate dev
pnpm --filter @compensation/database exec prisma db seed
pnpm dev                      # API on :4000, Web on :3000
```

## Deployment

```bash
# GKE (production)
gcloud container clusters get-credentials compportiq-prod-cluster \
  --region asia-south1 --project compportiq
kubectl apply -f infra/k8s/base/
kubectl get pods -n compportiq

# CI/CD: push to main → GitHub Actions → build + deploy
```

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | ≥64 char random string |
| `BENEFITS_ENCRYPTION_KEY` | Yes (prod) | ≥32 char, AES-256-GCM for PHI |
| `PLATFORM_CONFIG_ENCRYPTION_KEY` | Yes (prod) | ≥32 char, for platform secrets |
| `INTEGRATION_ENCRYPTION_KEY` | Yes | ≥32 char, for connector credentials |
| `AZURE_OPENAI_API_KEY` | Yes (prod) | Azure OpenAI key |
| `AZURE_OPENAI_ENDPOINT` | Yes (prod) | Azure OpenAI endpoint URL |
| `DB_HOST` / `DB_USER` / `DB_PWD` | Yes | Compport MySQL credentials |
| `AI_PROVIDER` | No | `azure` (prod) / `openai` (dev) |

See [context.md](context.md) for the complete engineering reference.

## License

Proprietary. Copyright Compport Technologies.
