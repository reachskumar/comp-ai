-- =============================================================================
-- Add missing indexes for frequently queried columns
-- =============================================================================

-- Employee: level, location, jobFamily (used in filtering/analytics)
CREATE INDEX IF NOT EXISTS "employees_tenantId_level_idx" ON "employees"("tenantId", "level");
CREATE INDEX IF NOT EXISTS "employees_tenantId_location_idx" ON "employees"("tenantId", "location");
CREATE INDEX IF NOT EXISTS "employees_tenantId_jobFamily_idx" ON "employees"("tenantId", "jobFamily");
CREATE INDEX IF NOT EXISTS "employees_jobLevelId_idx" ON "employees"("jobLevelId");

