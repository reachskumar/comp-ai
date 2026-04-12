-- Universal Compport Schema Catalog & Mirror State
--
-- Phase 1 of the universal sync architecture. Discovery walks every
-- table in a tenant's Compport schema and persists metadata here.
-- Phase 2 (mirror sync) reads from these tables to know what to mirror.

CREATE TABLE "tenant_schema_catalogs" (
  "id"                  TEXT PRIMARY KEY,
  "tenantId"            TEXT NOT NULL,
  "connectorId"         TEXT NOT NULL,
  "sourceSchema"        TEXT NOT NULL,
  "tableName"           TEXT NOT NULL,
  "rowCount"            INTEGER NOT NULL DEFAULT 0,
  "primaryKeyColumns"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "columns"             JSONB NOT NULL DEFAULT '[]'::jsonb,
  "lastModifiedColumn"  TEXT,
  "sampleRow"           JSONB,
  "isMirrorable"        BOOLEAN NOT NULL DEFAULT TRUE,
  "mirrorTableName"     TEXT,
  "discoveredAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastDiscoveredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_schema_catalogs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "tenant_schema_catalogs_tenantId_sourceSchema_tableName_key"
  ON "tenant_schema_catalogs"("tenantId", "sourceSchema", "tableName");
CREATE INDEX "tenant_schema_catalogs_tenantId_idx"
  ON "tenant_schema_catalogs"("tenantId");
CREATE INDEX "tenant_schema_catalogs_tenantId_isMirrorable_idx"
  ON "tenant_schema_catalogs"("tenantId", "isMirrorable");

-- RLS — same pattern as every other tenant-scoped table
ALTER TABLE "tenant_schema_catalogs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_schema_catalogs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select_tenant_schema_catalogs" ON "tenant_schema_catalogs"
  FOR SELECT USING (
    "tenantId" = current_setting('app.current_tenant_id', true)
    OR current_setting('app.current_tenant_id', true) IS NULL
    OR current_setting('app.current_tenant_id', true) = ''
  );

CREATE POLICY "tenant_isolation_insert_tenant_schema_catalogs" ON "tenant_schema_catalogs"
  FOR INSERT WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY "tenant_isolation_update_tenant_schema_catalogs" ON "tenant_schema_catalogs"
  FOR UPDATE USING (
    "tenantId" = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY "tenant_isolation_delete_tenant_schema_catalogs" ON "tenant_schema_catalogs"
  FOR DELETE USING (
    "tenantId" = current_setting('app.current_tenant_id', true)
  );


CREATE TABLE "tenant_data_mirror_states" (
  "id"               TEXT PRIMARY KEY,
  "tenantId"         TEXT NOT NULL,
  "mirrorSchema"     TEXT NOT NULL,
  "sourceTable"      TEXT NOT NULL,
  "mirrorTable"      TEXT NOT NULL,
  "rowCount"         INTEGER NOT NULL DEFAULT 0,
  "lastFullSyncAt"   TIMESTAMP(3),
  "lastDeltaSyncAt"  TIMESTAMP(3),
  "lastError"        TEXT,
  "watermarkType"    TEXT,
  "watermarkValue"   TEXT,
  "status"           TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_data_mirror_states_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "tenant_data_mirror_states_tenantId_sourceTable_key"
  ON "tenant_data_mirror_states"("tenantId", "sourceTable");
CREATE INDEX "tenant_data_mirror_states_tenantId_status_idx"
  ON "tenant_data_mirror_states"("tenantId", "status");

ALTER TABLE "tenant_data_mirror_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_data_mirror_states" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select_tenant_data_mirror_states" ON "tenant_data_mirror_states"
  FOR SELECT USING (
    "tenantId" = current_setting('app.current_tenant_id', true)
    OR current_setting('app.current_tenant_id', true) IS NULL
    OR current_setting('app.current_tenant_id', true) = ''
  );

CREATE POLICY "tenant_isolation_insert_tenant_data_mirror_states" ON "tenant_data_mirror_states"
  FOR INSERT WITH CHECK (
    "tenantId" = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY "tenant_isolation_update_tenant_data_mirror_states" ON "tenant_data_mirror_states"
  FOR UPDATE USING (
    "tenantId" = current_setting('app.current_tenant_id', true)
  );

CREATE POLICY "tenant_isolation_delete_tenant_data_mirror_states" ON "tenant_data_mirror_states"
  FOR DELETE USING (
    "tenantId" = current_setting('app.current_tenant_id', true)
  );
