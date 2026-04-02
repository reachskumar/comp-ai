-- =============================================================================
-- RLS Migration: Apply to 22 tables created after the initial RLS migration
--
-- These tables were created in migrations 20260318110000, 20260306100000,
-- 20260320100000, and 20260401100000 but never had RLS policies applied.
--
-- Reuses the same helper pattern from 20260227100000_add_rls_policies.
-- vesting_events is excluded (no tenantId — isolated via FK to equity_grants).
-- copilot_messages is excluded (no tenantId — isolated via FK to copilot_conversations).
-- =============================================================================

-- Recreate helper (was dropped in original migration)
CREATE OR REPLACE FUNCTION _enable_rls_for_table(tbl regclass) RETURNS void AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);

  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON %s', tbl);

  EXECUTE format(
    'CREATE POLICY tenant_isolation_select ON %s FOR SELECT USING ("tenantId" = current_setting(''app.current_tenant_id'', true))',
    tbl
  );
  EXECUTE format(
    'CREATE POLICY tenant_isolation_insert ON %s FOR INSERT WITH CHECK ("tenantId" = current_setting(''app.current_tenant_id'', true))',
    tbl
  );
  EXECUTE format(
    'CREATE POLICY tenant_isolation_update ON %s FOR UPDATE USING ("tenantId" = current_setting(''app.current_tenant_id'', true))',
    tbl
  );
  EXECUTE format(
    'CREATE POLICY tenant_isolation_delete ON %s FOR DELETE USING ("tenantId" = current_setting(''app.current_tenant_id'', true))',
    tbl
  );
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Compensation & Pay
-- =============================================================================
SELECT _enable_rls_for_table('salary_bands');
SELECT _enable_rls_for_table('market_data_sources');
SELECT _enable_rls_for_table('merit_matrices');
SELECT _enable_rls_for_table('ad_hoc_increases');
SELECT _enable_rls_for_table('exchange_rates');
SELECT _enable_rls_for_table('tenant_currencies');
SELECT _enable_rls_for_table('rewards_statements');

-- =============================================================================
-- Equity
-- =============================================================================
SELECT _enable_rls_for_table('equity_plans');
SELECT _enable_rls_for_table('equity_grants');
-- vesting_events: no tenantId column — isolated via FK cascade from equity_grants

-- =============================================================================
-- Attrition
-- =============================================================================
SELECT _enable_rls_for_table('attrition_risk_scores');
SELECT _enable_rls_for_table('attrition_analysis_runs');

-- =============================================================================
-- Policy RAG
-- =============================================================================
SELECT _enable_rls_for_table('policy_documents');
SELECT _enable_rls_for_table('policy_chunks');

-- =============================================================================
-- Job Architecture
-- =============================================================================
SELECT _enable_rls_for_table('job_families');
SELECT _enable_rls_for_table('job_levels');
SELECT _enable_rls_for_table('career_ladders');

-- =============================================================================
-- Write-Back
-- =============================================================================
SELECT _enable_rls_for_table('write_back_batches');
SELECT _enable_rls_for_table('write_back_records');

-- =============================================================================
-- Dynamic Roles & Permissions (from 20260401100000)
-- =============================================================================
SELECT _enable_rls_for_table('tenant_roles');
SELECT _enable_rls_for_table('tenant_pages');
SELECT _enable_rls_for_table('tenant_role_permissions');

-- =============================================================================
-- Copilot (from 20260306100000)
-- =============================================================================
SELECT _enable_rls_for_table('copilot_conversations');
-- copilot_messages: no tenantId column — isolated via FK cascade from copilot_conversations

-- Clean up helper
DROP FUNCTION _enable_rls_for_table(regclass);

