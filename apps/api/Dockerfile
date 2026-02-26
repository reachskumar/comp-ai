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

# Copy source code
COPY packages/database/ ./packages/database/
COPY packages/shared/ ./packages/shared/
COPY packages/ai/ ./packages/ai/
COPY apps/api/ ./apps/api/

# Copy base tsconfig
COPY tsconfig.base.json ./

# Generate Prisma client and build the API (turbo handles dependency order)
RUN pnpm build --filter=@compensation/api

# ── Stage 4: Production ───────────────────────────────────────
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
RUN apk add --no-cache libc6-compat

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace config for pnpm to resolve workspace structure
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/packages/database/package.json ./packages/database/package.json
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/ai/package.json ./packages/ai/package.json
COPY --from=builder /app/packages/ui/package.json ./packages/ui/package.json
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json

# Copy Prisma schema + config before install (needed for postinstall prisma generate)
COPY --from=builder /app/packages/database/prisma/ ./packages/database/prisma/
COPY --from=builder /app/packages/database/prisma.config.ts ./packages/database/prisma.config.ts

RUN pnpm install --frozen-lockfile --prod --ignore-scripts && \
    cd packages/database && pnpm exec prisma generate

# Copy built artifacts
COPY --from=builder /app/apps/api/dist/ ./apps/api/dist/
COPY --from=builder /app/packages/database/dist/ ./packages/database/dist/
COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/ai/dist/ ./packages/ai/dist/

# Copy Prisma generated client (needed at runtime)
COPY --from=builder /app/packages/database/src/generated/ ./packages/database/src/generated/

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
USER nestjs

EXPOSE 4000

CMD ["node", "--experimental-require-module", "apps/api/dist/main.js"]

