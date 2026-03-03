-- =============================================================================
-- Add tenant branding fields, PLATFORM_ADMIN role, and tenant suspension
-- =============================================================================

-- Add PLATFORM_ADMIN to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN' BEFORE 'ADMIN';

-- Add branding and management fields to tenants table
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subdomain" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "customDomain" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "primaryColor" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "compportSchema" TEXT;

-- Unique constraints for subdomain and custom domain lookups
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_subdomain_key" ON "tenants"("subdomain");
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_customDomain_key" ON "tenants"("customDomain");

