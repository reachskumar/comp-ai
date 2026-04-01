-- =============================================================================
-- RLS Auth Bypass Policy
--
-- The auth login flow queries the `users` table by email WITHOUT a tenant
-- context (app.current_tenant_id is not set). RLS's FORCE policy returns
-- zero rows, causing "Invalid credentials" even when the user exists.
--
-- This adds a permissive SELECT policy that allows reads when no tenant
-- context is set. The existing tenant_isolation_select policy still
-- restricts scoped queries to the correct tenant.
--
-- Only SELECT is allowed — INSERT/UPDATE/DELETE still require tenant context.
-- =============================================================================

-- Allow SELECT on users when no tenant context is set (auth flow)
DROP POLICY IF EXISTS auth_bypass_select ON users;
CREATE POLICY auth_bypass_select ON users
  FOR SELECT
  USING (
    current_setting('app.current_tenant_id', true) IS NULL
    OR current_setting('app.current_tenant_id', true) = ''
  );



