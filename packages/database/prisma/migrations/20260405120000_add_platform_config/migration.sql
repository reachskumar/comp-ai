-- Platform configuration table (admin-managed settings)
CREATE TABLE IF NOT EXISTS "platform_config" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "category" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "is_secret" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "platform_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_config_category_key_key" ON "platform_config"("category", "key");
CREATE INDEX IF NOT EXISTS "platform_config_category_idx" ON "platform_config"("category");

-- Seed default AI configuration
INSERT INTO "platform_config" ("id", "category", "key", "value", "is_secret", "description")
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
