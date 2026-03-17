-- =============================================================================
-- Row-Level Security (RLS) Migration
-- Enables tenant isolation at the database level for all tenant-scoped tables.
--
-- How it works:
--   1. Application sets: SET LOCAL app.current_tenant_id = '<id>';
--   2. RLS policies automatically filter rows by tenantId
--   3. If tenant context is NOT set, zero rows are returned (safe default)
--
-- Rollback: See bottom of file for DISABLE/DROP statements.
-- =============================================================================

-- Helper function to apply RLS to a table with a "tenantId" column.
-- Creates SELECT, INSERT, UPDATE, DELETE policies.
CREATE OR REPLACE FUNCTION _enable_rls_for_table(tbl regclass) RETURNS void AS $$
BEGIN
  -- Enable RLS on the table
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);

  -- SELECT: only rows matching current tenant
  EXECUTE format(
    'CREATE POLICY tenant_isolation_select ON %s FOR SELECT USING ("tenantId" = current_setting(''app.current_tenant_id'', true))',
    tbl
  );

  -- INSERT: can only insert rows for current tenant
  EXECUTE format(
    'CREATE POLICY tenant_isolation_insert ON %s FOR INSERT WITH CHECK ("tenantId" = current_setting(''app.current_tenant_id'', true))',
    tbl
  );

  -- UPDATE: can only update rows belonging to current tenant
  EXECUTE format(
    'CREATE POLICY tenant_isolation_update ON %s FOR UPDATE USING ("tenantId" = current_setting(''app.current_tenant_id'', true))',
    tbl
  );

  -- DELETE: can only delete rows belonging to current tenant
  EXECUTE format(
    'CREATE POLICY tenant_isolation_delete ON %s FOR DELETE USING ("tenantId" = current_setting(''app.current_tenant_id'', true))',
    tbl
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Apply RLS to all 39 tenant-scoped tables
-- =============================================================================

-- Core identity & HR
SELECT _enable_rls_for_table('users');
SELECT _enable_rls_for_table('employees');

-- Data import
SELECT _enable_rls_for_table('import_jobs');
SELECT _enable_rls_for_table('import_ai_analyses');

-- Rules engine
SELECT _enable_rls_for_table('rule_sets');

-- Simulation
SELECT _enable_rls_for_table('simulation_runs');
SELECT _enable_rls_for_table('simulation_scenarios');

-- Compensation cycles
SELECT _enable_rls_for_table('comp_cycles');

-- Payroll
SELECT _enable_rls_for_table('payroll_runs');

-- Audit & notifications
SELECT _enable_rls_for_table('audit_logs');
SELECT _enable_rls_for_table('notifications');

-- Integrations
SELECT _enable_rls_for_table('integration_connectors');
SELECT _enable_rls_for_table('sync_jobs');
SELECT _enable_rls_for_table('field_mappings');
SELECT _enable_rls_for_table('webhook_endpoints');

-- Benefits
SELECT _enable_rls_for_table('benefit_plans');
SELECT _enable_rls_for_table('benefit_enrollments');
SELECT _enable_rls_for_table('enrollment_windows');
SELECT _enable_rls_for_table('life_events');

-- Reports
SELECT _enable_rls_for_table('saved_reports');

-- Policy & compliance (AI agents)
SELECT _enable_rls_for_table('policy_conversions');
SELECT _enable_rls_for_table('compliance_scans');
-- NOTE: policy_documents and policy_chunks tables do not exist yet (no migration creates them).
-- RLS will be added when those tables are created.

-- Compensation letters
SELECT _enable_rls_for_table('compensation_letters');

-- NOTE: The following tables are defined in schema.prisma but no migration creates them yet.
-- RLS will be added when those tables get their CREATE TABLE migrations:
--   merit_matrices, salary_bands, market_data_sources,
--   ad_hoc_increases, exchange_rates, tenant_currencies,
--   rewards_statements, equity_plans, equity_grants,
--   attrition_risk_scores, attrition_analysis_runs,
--   job_families, job_levels, career_ladders

-- Clean up the helper function (no longer needed at runtime)
DROP FUNCTION _enable_rls_for_table(regclass);

-- =============================================================================
-- ROLLBACK (run manually if you need to revert RLS)
-- =============================================================================
--
-- CREATE OR REPLACE FUNCTION _disable_rls_for_table(tbl regclass) RETURNS void AS $$
-- BEGIN
--   EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %s', tbl);
--   EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON %s', tbl);
--   EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON %s', tbl);
--   EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON %s', tbl);
--   EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', tbl);
-- END;
-- $$ LANGUAGE plpgsql;
--
-- SELECT _disable_rls_for_table('users');
-- SELECT _disable_rls_for_table('employees');
-- ... (repeat for all 39 tables)
-- DROP FUNCTION _disable_rls_for_table(regclass);
-- =============================================================================

