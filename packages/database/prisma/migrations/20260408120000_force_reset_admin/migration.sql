-- First get the tenant ID for the platform admin, then set RLS context
DO $$
DECLARE
  v_tenant_id TEXT;
BEGIN
  -- Find the platform tenant ID
  SELECT "id" INTO v_tenant_id FROM "tenants" WHERE "slug" = 'platform' LIMIT 1;

  IF v_tenant_id IS NOT NULL THEN
    -- Set RLS context so UPDATE can proceed
    PERFORM set_config('app.current_tenant_id', v_tenant_id, false);

    -- Reset password to ChangeMe123!@# (bcrypt hash) and clear lockout
    UPDATE "users"
    SET "passwordHash" = '$2b$12$5t1cIh.9Kwa9n/CeHjtrEeioGHxQaPNNgEfMh6GI3jZLivVOwFB1O',
        "failedLoginAttempts" = 0,
        "lockedUntil" = NULL
    WHERE "email" = 'admin@compportiq.ai'
      AND "tenantId" = v_tenant_id;

    RAISE NOTICE 'Admin password reset for tenant %', v_tenant_id;
  ELSE
    RAISE NOTICE 'Platform tenant not found - skipping admin reset';
  END IF;
END $$;
