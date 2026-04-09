-- Create integration connectors for tenants that have compportSchema but no connector.
-- This fixes tenants created from the Platform Admin UI (which didn't auto-create connectors).
INSERT INTO "integration_connectors" ("id", "tenantId", "name", "connectorType", "status", "syncDirection", "syncSchedule", "conflictStrategy", "config", "metadata", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t."id",
  'Compport - ' || t."name",
  'COMPPORT_CLOUDSQL',
  'ACTIVE',
  'INBOUND',
  'DAILY',
  'SOURCE_PRIORITY',
  jsonb_build_object('cloudSqlSchema', t."compportSchema", 'schemaName', t."compportSchema"),
  '{}',
  NOW(),
  NOW()
FROM "tenants" t
WHERE t."compportSchema" IS NOT NULL
  AND t."compportSchema" != ''
  AND NOT EXISTS (
    SELECT 1 FROM "integration_connectors" ic
    WHERE ic."tenantId" = t."id" AND ic."connectorType" = 'COMPPORT_CLOUDSQL'
  );
