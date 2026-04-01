-- =============================================================================
-- Dynamic Roles & Permissions Migration
--
-- Replaces the hardcoded UserRole PostgreSQL ENUM with a String field on users,
-- and adds tenant-scoped role/permission tables synced from Compport Cloud SQL.
--
-- Changes:
--   1. ALTER users.role from UserRole ENUM → TEXT
--   2. CREATE tenant_roles, tenant_pages, tenant_role_permissions tables
--   3. ADD employeeId FK on users → employees
--   4. Enable RLS on new tables
-- =============================================================================

-- ─── Step 1: Convert users.role from ENUM to TEXT ───────────────────────────

-- Drop the default first (it references the enum type)
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

-- Change column type from UserRole enum to TEXT, casting existing values
ALTER TABLE "users" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;

-- Set new default as plain text string
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';

-- Drop the UserRole enum type (no longer needed)
DROP TYPE IF EXISTS "UserRole";

-- ─── Step 2: Add employeeId FK on users ─────────────────────────────────────

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employeeId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_employeeId_key" ON "users"("employeeId");
CREATE INDEX IF NOT EXISTS "users_employeeId_idx" ON "users"("employeeId");
ALTER TABLE "users" ADD CONSTRAINT "users_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Step 3: Create tenant_roles table ──────────────────────────────────────

CREATE TABLE "tenant_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "compportRoleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_roles_tenantId_compportRoleId_key"
  ON "tenant_roles"("tenantId", "compportRoleId");
CREATE INDEX "tenant_roles_tenantId_idx" ON "tenant_roles"("tenantId");

ALTER TABLE "tenant_roles" ADD CONSTRAINT "tenant_roles_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Step 4: Create tenant_pages table ──────────────────────────────────────

CREATE TABLE "tenant_pages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "compportPageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uriSegment" TEXT,
    "pageType" TEXT,
    "status" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_pages_tenantId_compportPageId_key"
  ON "tenant_pages"("tenantId", "compportPageId");
CREATE INDEX "tenant_pages_tenantId_idx" ON "tenant_pages"("tenantId");

ALTER TABLE "tenant_pages" ADD CONSTRAINT "tenant_pages_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Step 5: Create tenant_role_permissions table ───────────────────────────

CREATE TABLE "tenant_role_permissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canInsert" BOOLEAN NOT NULL DEFAULT false,
    "canUpdate" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_role_permissions_tenantId_roleId_pageId_key"
  ON "tenant_role_permissions"("tenantId", "roleId", "pageId");
CREATE INDEX "tenant_role_permissions_tenantId_idx"
  ON "tenant_role_permissions"("tenantId");
CREATE INDEX "tenant_role_permissions_roleId_idx"
  ON "tenant_role_permissions"("roleId");
CREATE INDEX "tenant_role_permissions_tenantId_roleId_idx"
  ON "tenant_role_permissions"("tenantId", "roleId");

ALTER TABLE "tenant_role_permissions" ADD CONSTRAINT "tenant_role_permissions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_role_permissions" ADD CONSTRAINT "tenant_role_permissions_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "tenant_roles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_role_permissions" ADD CONSTRAINT "tenant_role_permissions_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "tenant_pages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Step 6: Enable RLS on new tables ─────────────────────────────────────────

ALTER TABLE "tenant_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_role_permissions" ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies (same pattern as existing tables)
CREATE POLICY "tenant_roles_tenant_isolation" ON "tenant_roles"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY "tenant_pages_tenant_isolation" ON "tenant_pages"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY "tenant_role_permissions_tenant_isolation" ON "tenant_role_permissions"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- Bypass policies for the application role (same pattern as rls_auth_bypass migration)
CREATE POLICY "tenant_roles_bypass" ON "tenant_roles"
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "tenant_pages_bypass" ON "tenant_pages"
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "tenant_role_permissions_bypass" ON "tenant_role_permissions"
  FOR ALL USING (true) WITH CHECK (true);

