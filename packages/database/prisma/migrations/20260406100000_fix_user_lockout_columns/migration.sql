-- Fix column naming from conflicting migrations.
-- This project uses quoted camelCase columns (Prisma default without @map).
-- Our migration 20260405100000 incorrectly used snake_case column names.

-- 1. Fix User table columns
-- Drop the snake_case duplicates from our migration
ALTER TABLE "users" DROP COLUMN IF EXISTS "failed_login_count";
ALTER TABLE "users" DROP COLUMN IF EXISTS "locked_until";
ALTER TABLE "users" DROP COLUMN IF EXISTS "last_login_at";

-- Remote migration (20260402100300) already created "failedLoginAttempts" and "lockedUntil".
-- We only need to add "lastLoginAt" which was missing.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMPTZ;

-- 2. Recreate token_blacklist with camelCase columns (Prisma convention)
DROP TABLE IF EXISTS "token_blacklist";
CREATE TABLE "token_blacklist" (
  "id" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'logout',
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "token_blacklist_jti_key" ON "token_blacklist"("jti");
CREATE INDEX IF NOT EXISTS "token_blacklist_userId_idx" ON "token_blacklist"("userId");
CREATE INDEX IF NOT EXISTS "token_blacklist_expiresAt_idx" ON "token_blacklist"("expiresAt");

-- RLS for token_blacklist
ALTER TABLE "token_blacklist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_blacklist" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "token_blacklist_tenant_isolation" ON "token_blacklist";
CREATE POLICY "token_blacklist_tenant_isolation" ON "token_blacklist"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- 3. Recreate user_sessions with camelCase columns (Prisma convention)
DROP TABLE IF EXISTS "user_sessions";
CREATE TABLE "user_sessions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "lastActiveAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_sessions_jti_key" ON "user_sessions"("jti");
CREATE INDEX IF NOT EXISTS "user_sessions_userId_idx" ON "user_sessions"("userId");
CREATE INDEX IF NOT EXISTS "user_sessions_tenantId_idx" ON "user_sessions"("tenantId");
CREATE INDEX IF NOT EXISTS "user_sessions_expiresAt_idx" ON "user_sessions"("expiresAt");

-- RLS for user_sessions
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_sessions_tenant_isolation" ON "user_sessions";
CREATE POLICY "user_sessions_tenant_isolation" ON "user_sessions"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- 4. Recreate platform_config with camelCase columns (Prisma convention)
DROP TABLE IF EXISTS "platform_config";
CREATE TABLE "platform_config" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "isSecret" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "platform_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_config_category_key_key" ON "platform_config"("category", "key");
CREATE INDEX IF NOT EXISTS "platform_config_category_idx" ON "platform_config"("category");

-- Re-seed default AI configuration
INSERT INTO "platform_config" ("id", "category", "key", "value", "isSecret", "description")
VALUES
  (gen_random_uuid()::text, 'ai', 'provider', 'azure', false, 'AI provider: openai or azure'),
  (gen_random_uuid()::text, 'ai', 'default_model', 'gpt-4o', false, 'Default model for all agents'),
  (gen_random_uuid()::text, 'ai', 'model_reasoning', '', false, 'Model for Tier 1 agents (compliance, simulation, budget)'),
  (gen_random_uuid()::text, 'ai', 'model_interactive', '', false, 'Model for Tier 2 agents (copilot, policy RAG)'),
  (gen_random_uuid()::text, 'ai', 'model_batch', '', false, 'Model for Tier 3 agents (letters, field mapping, reports)'),
  (gen_random_uuid()::text, 'ai', 'temperature_default', '0.2', false, 'Default temperature for AI agents'),
  (gen_random_uuid()::text, 'ai', 'max_tokens_default', '2048', false, 'Default max tokens for AI responses'),
  (gen_random_uuid()::text, 'ai', 'monthly_budget_cents', '5000', false, 'Per-tenant monthly AI budget in cents ($50 default)')
ON CONFLICT ("category", "key") DO NOTHING;
