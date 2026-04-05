-- Add account lockout fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMPTZ;

-- Token blacklist for logout / session revocation
CREATE TABLE IF NOT EXISTS "token_blacklist" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "jti" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'logout',
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "token_blacklist_jti_key" ON "token_blacklist"("jti");
CREATE INDEX IF NOT EXISTS "token_blacklist_user_id_idx" ON "token_blacklist"("user_id");
CREATE INDEX IF NOT EXISTS "token_blacklist_expires_at_idx" ON "token_blacklist"("expires_at");

-- RLS policy for token_blacklist
ALTER TABLE "token_blacklist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_blacklist" FORCE ROW LEVEL SECURITY;

CREATE POLICY "token_blacklist_tenant_isolation" ON "token_blacklist"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true));

-- Active sessions table for session management
CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "jti" TEXT NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "last_active_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_sessions_jti_key" ON "user_sessions"("jti");
CREATE INDEX IF NOT EXISTS "user_sessions_user_id_idx" ON "user_sessions"("user_id");
CREATE INDEX IF NOT EXISTS "user_sessions_tenant_id_idx" ON "user_sessions"("tenant_id");
CREATE INDEX IF NOT EXISTS "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- RLS policy for user_sessions
ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "user_sessions_tenant_isolation" ON "user_sessions"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true));
