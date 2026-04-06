-- Add missing FK constraints from tenantId → tenants(id) ON DELETE CASCADE.
-- These tables were created in earlier migrations without FK constraints,
-- so DELETE FROM tenants cannot cascade to them.

-- Drop existing constraints if they exist (idempotent)
ALTER TABLE "field_mappings" DROP CONSTRAINT IF EXISTS "field_mappings_tenantId_fkey";
ALTER TABLE "sync_jobs" DROP CONSTRAINT IF EXISTS "sync_jobs_tenantId_fkey";
ALTER TABLE "webhook_endpoints" DROP CONSTRAINT IF EXISTS "webhook_endpoints_tenantId_fkey";
ALTER TABLE "saved_reports" DROP CONSTRAINT IF EXISTS "saved_reports_tenantId_fkey";
ALTER TABLE "policy_conversions" DROP CONSTRAINT IF EXISTS "policy_conversions_tenantId_fkey";
ALTER TABLE "compensation_letters" DROP CONSTRAINT IF EXISTS "compensation_letters_tenantId_fkey";
ALTER TABLE "import_ai_analyses" DROP CONSTRAINT IF EXISTS "import_ai_analyses_tenantId_fkey";
ALTER TABLE "simulation_scenarios" DROP CONSTRAINT IF EXISTS "simulation_scenarios_tenantId_fkey";
ALTER TABLE "compliance_scans" DROP CONSTRAINT IF EXISTS "compliance_scans_tenantId_fkey";
ALTER TABLE "token_blacklist" DROP CONSTRAINT IF EXISTS "token_blacklist_tenantId_fkey";
ALTER TABLE "user_sessions" DROP CONSTRAINT IF EXISTS "user_sessions_tenantId_fkey";

-- Add FK constraints with ON DELETE CASCADE
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "policy_conversions" ADD CONSTRAINT "policy_conversions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compensation_letters" ADD CONSTRAINT "compensation_letters_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "import_ai_analyses" ADD CONSTRAINT "import_ai_analyses_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "simulation_scenarios" ADD CONSTRAINT "simulation_scenarios_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compliance_scans" ADD CONSTRAINT "compliance_scans_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "token_blacklist" ADD CONSTRAINT "token_blacklist_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
