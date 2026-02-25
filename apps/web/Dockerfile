# ── Stage 1: Base ──────────────────────────────────────────────
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
RUN apk add --no-cache libc6-compat

# ── Stage 2: Install dependencies ──────────────────────────────
FROM base AS deps
WORKDIR /app

# Copy workspace config files for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY turbo.json ./

# Copy all workspace package.json files (needed for pnpm install)
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ai/package.json ./packages/ai/package.json
COPY packages/ui/package.json ./packages/ui/package.json

# Prisma schema + config needed for postinstall (prisma generate)
COPY packages/database/prisma/schema.prisma ./packages/database/prisma/schema.prisma
COPY packages/database/prisma.config.ts ./packages/database/prisma.config.ts

RUN pnpm install --frozen-lockfile

# ── Stage 3: Build ─────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/ ./

# Copy source code for web and its dependencies
COPY packages/shared/ ./packages/shared/
COPY packages/ui/ ./packages/ui/
COPY apps/web/ ./apps/web/

# Copy base tsconfig
COPY tsconfig.base.json ./

# Build the web app (turbo handles dependency order)
RUN pnpm build --filter=@compensation/web

# ── Stage 4: Production ───────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy Next.js standalone output
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

CMD ["node", "apps/web/server.js"]

