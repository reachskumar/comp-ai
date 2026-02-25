# Compport AI Platform

> AI-powered compensation intelligence — 10 agents, 37 pages, 146 API endpoints.

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-1.1-1C3C3C?logo=langchain&logoColor=white)

---

## Overview

Compport AI Platform is an AI-powered companion to Compport for compensation intelligence. It combines a modern web dashboard with a robust API layer and a suite of AI agents to automate compensation analysis, compliance scanning, pay-equity auditing, letter generation, and more.

The platform is built as a **pnpm monorepo** with a Next.js 14 frontend, a NestJS 10 API (on Fastify), and a LangGraph-based AI layer. Data is persisted in PostgreSQL 16 via Prisma, with Redis 7 powering BullMQ job queues for background processing. All AI agents run as LangGraph state-machine graphs backed by OpenAI GPT-4o.

The system ships with 10 AI agent graphs, 37 frontend pages (including auth, dashboard, analytics, compliance, benefits, payroll, integrations, and settings), and 146 REST API endpoints exposed via Swagger.

---

## Architecture

```
┌─────────────┐     REST/SSE      ┌──────────────┐     Prisma      ┌──────────────┐
│  Next.js 14  │ ───────────────▶ │  NestJS 10   │ ─────────────▶ │ PostgreSQL 16 │
│  (Frontend)  │                  │  (API)       │                └──────────────┘
└─────────────┘                  │              │     BullMQ      ┌──────────────┐
                                  │              │ ─────────────▶ │   Redis 7     │
                                  └──────┬───────┘                └──────────────┘
                                         │ LangGraph
                                  ┌──────▼───────┐
                                  │  AI Agents    │──── OpenAI GPT-4o
                                  │  (10 graphs)  │
                                  └──────────────┘
```

---

## Quick Start

### Prerequisites

| Tool   | Version |
|--------|---------|
| Node.js | ≥ 20.0  |
| pnpm   | ≥ 10.x  |
| Docker | Latest  |

### Setup

```bash
# 1. Clone the repository
git clone <repo-url> && cd compensation-platform

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env — at minimum set OPENAI_API_KEY

# 4. Start infrastructure (PostgreSQL + Redis)
docker compose up -d

# 5. Run database migrations and seed
pnpm db:migrate
pnpm db:seed

# 6. Start development servers
pnpm dev
```

The web app runs at **http://localhost:3000** and the API at **http://localhost:4000**.

---

## Project Structure

```
compensation-platform/
├── apps/
│   ├── api/             # NestJS 10 REST API (Fastify)
│   └── web/             # Next.js 14 frontend (React 18, Tailwind CSS 4)
├── packages/
│   ├── ai/              # LangGraph AI agent graphs & tools
│   ├── database/        # Prisma schema, migrations, seed
│   ├── shared/          # Shared types, rules engine, data-hygiene utils
│   └── ui/              # Shared React UI components
├── tests/
│   └── e2e/             # Playwright end-to-end tests
├── docker-compose.yml   # PostgreSQL 16 + Redis 7
├── turbo.json           # Turborepo pipeline config
└── pnpm-workspace.yaml  # Workspace definition
```

---

## Available Scripts

Run from the repository root:

| Command            | Description                                |
|--------------------|--------------------------------------------|
| `pnpm dev`         | Start all apps in development (watch mode) |
| `pnpm build`       | Build all packages and apps                |
| `pnpm lint`        | Lint all packages with ESLint              |
| `pnpm test`        | Run unit tests (Vitest)                    |
| `pnpm test:e2e`    | Run Playwright end-to-end tests            |
| `pnpm format`      | Format code with Prettier                  |
| `pnpm db:migrate`  | Run Prisma database migrations             |
| `pnpm db:seed`     | Seed the database with demo data           |

---

## AI Capabilities

The platform includes **10 LangGraph agent graphs**, each purpose-built for a compensation domain:

| Agent                 | Description                                                    |
|-----------------------|----------------------------------------------------------------|
| **Copilot**           | Conversational AI assistant for compensation Q&A               |
| **Pay Equity**        | Analyzes pay gaps across demographics and recommends remediation|
| **Anomaly Explainer** | Detects and explains payroll anomalies with root-cause analysis|
| **Compliance Scanner**| Scans compensation data against labor law and policy rules     |
| **Data Quality**      | Audits data hygiene issues — missing fields, outliers, dupes   |
| **Field Mapping**     | Auto-maps imported CSV/Excel columns to internal schema fields |
| **Letter Generator**  | Generates personalized compensation letters (offer, revision)  |
| **Report Builder**    | Builds custom compensation reports with AI-driven insights     |
| **Simulation**        | Models "what-if" scenarios for budget changes and merit pools  |
| **Echo**              | Diagnostic echo agent for testing the AI pipeline              |

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable               | Description                                  | Default                          |
|------------------------|----------------------------------------------|----------------------------------|
| `DATABASE_URL`         | PostgreSQL connection string                 | `postgresql://postgres:postgres@localhost:5432/compensation_db` |
| `REDIS_URL`            | Redis connection string                      | `redis://localhost:6379`         |
| `NEXT_PUBLIC_API_URL`  | API URL for the frontend                     | `http://localhost:4000`          |
| `NEXTAUTH_URL`         | NextAuth callback URL                        | `http://localhost:3000`          |
| `NEXTAUTH_SECRET`      | NextAuth session secret                      | *(change in production)*         |
| `API_PORT`             | NestJS API server port                       | `4000`                           |
| `JWT_SECRET`           | JWT signing secret                           | *(change in production)*         |
| `JWT_EXPIRATION`       | JWT token TTL                                | `1d`                             |
| `CORS_ORIGINS`         | Allowed CORS origins (comma-separated)       | `http://localhost:3000`          |
| `OPENAI_API_KEY`       | OpenAI API key for AI agents                 | *(required)*                     |
| `OPENAI_MODEL`         | OpenAI model name                            | `gpt-4o`                         |
| `NODE_ENV`             | Environment (`development` / `production`)   | `development`                    |
| `COMPPORT_MODE`        | Integration mode: `standalone`, `shared_db`, or `api_bridge` | `standalone`     |

---

## API Documentation

Interactive Swagger documentation is available in development at:

```
http://localhost:4000/api-docs
```

All endpoints are prefixed with `/api/v1`. Bearer JWT authentication is required for protected routes.

---

## Demo Credentials

After running `pnpm db:seed`:

| Email              | Password       | Role  |
|--------------------|---------------|-------|
| admin@acme.com     | Admin123!@#   | Admin |

---

## Tech Stack

| Layer       | Technology                           | Version |
|-------------|--------------------------------------|---------|
| Language    | TypeScript                           | 5.9     |
| Backend     | NestJS (Fastify)                     | 10.4    |
| Frontend    | Next.js (React 18, Tailwind CSS 4)   | 14.2    |
| Database    | PostgreSQL                           | 16      |
| ORM         | Prisma                               | Latest  |
| AI / LLM    | LangGraph + OpenAI GPT-4o           | 1.1     |
| Queue       | BullMQ (Redis)                       | 5.x     |
| Cache       | Redis                                | 7       |
| Testing     | Vitest + Playwright                  | 4.x     |
| Monorepo    | Turborepo + pnpm workspaces          | 2.x     |
| Linting     | ESLint 9 + Prettier                  | 9.x     |

---

## License

Proprietary — © Compport. All rights reserved.
