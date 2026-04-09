-- Create integration connectors for tenants that have compportSchema but no connector.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t."id" AS tenant_id, t."name" AS tenant_name, t."compportSchema" AS schema_name
    FROM "tenants" t
    WHERE t."compportSchema" IS NOT NULL
      AND t."compportSchema" != ''
      AND NOT EXISTS (
        SELECT 1 FROM "integration_connectors" ic
        WHERE ic."tenantId" = t."id" AND ic."connectorType" = 'COMPPORT_CLOUDSQL'
      )
  LOOP
    INSERT INTO "integration_connectors" (
      "id", "tenantId", "name", "connectorType", "status",
      "syncDirection", "syncSchedule", "conflictStrategy",
      "config", "metadata", "createdAt", "updatedAt"
    ) VALUES (
      'conn_' || substr(md5(random()::text), 1, 20),
      r.tenant_id,
      'Compport - ' || r.tenant_name,
      'COMPPORT_CLOUDSQL',
      'ACTIVE',
      'INBOUND',
      'DAILY',
      'SOURCE_PRIORITY',
      ('{"cloudSqlSchema":"' || r.schema_name || '","schemaName":"' || r.schema_name || '"}')::jsonb,
      '{}'::jsonb,
      NOW(),
      NOW()
    );
    RAISE NOTICE 'Created connector for tenant % (%)', r.tenant_name, r.tenant_id;
  END LOOP;
END $$;
