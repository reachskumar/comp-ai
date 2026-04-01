import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CompportCloudSqlService } from './compport-cloudsql.service';
import { CredentialVaultService } from '../../integrations/services/credential-vault.service';
import { FieldMappingService } from '../../integrations/services/field-mapping.service';
import { CloudSqlEmployeeRowSchema } from '../schemas/compport-data.schemas';

const BATCH_SIZE = 1000;

/** Lookup tables from Compport manage_* tables: numeric ID → human-readable name */
interface LookupMaps {
  functions: Map<number, string>;
  levels: Map<number, string>;
  grades: Map<number, string>;
  designations: Map<number, string>;
  cities: Map<number, string>;
  subfunctions: Map<number, string>;
  employeeRoles: Map<number, string>;
  employeeTypes: Map<number, string>;
  costCenters: Map<number, string>;
  countries: Map<number, string>;
  businessLevel1: Map<number, string>;
  businessLevel2: Map<number, string>;
  businessLevel3: Map<number, string>;
  educations: Map<number, string>;
  roles: Map<number, string>;
}

export interface InboundSyncResult {
  syncJobId: string;
  entityType: string;
  durationMs: number;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  skippedRecords: number;
}

export interface RoleSyncResult {
  roles: { synced: number; errors: number };
  pages: { synced: number; errors: number };
  permissions: { synced: number; errors: number };
  users: { synced: number; linked: number; errors: number };
  durationMs: number;
}

/**
 * Inbound Sync Service
 *
 * Core ETL logic: reads from Compport Cloud SQL (MySQL),
 * transforms via FieldMapping, and upserts into CompportIQ PostgreSQL.
 *
 * Flow per entity:
 * 1. Load connector config + decrypt credentials
 * 2. Connect to Cloud SQL
 * 3. USE tenant schema
 * 4. SELECT with pagination (BATCH_SIZE rows)
 * 5. Validate each row with Zod
 * 6. Apply FieldMapping transforms
 * 7. Upsert into PostgreSQL via Prisma forTenant()
 * 8. Create SyncJob + SyncLog records
 * 9. Update connector lastSyncAt
 *
 * SECURITY:
 * - Parameterized queries only
 * - Credentials decrypted per-request
 * - All operations RLS-scoped via forTenant()
 */
@Injectable()
export class InboundSyncService {
  private readonly logger = new Logger(InboundSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cloudSql: CompportCloudSqlService,
    private readonly credentialVault: CredentialVaultService,
    private readonly fieldMappingService: FieldMappingService,
  ) {}

  /**
   * Sync all entities for a connector (employees + compensation).
   */
  async syncAll(
    tenantId: string,
    connectorId: string,
    syncJobId: string,
  ): Promise<InboundSyncResult> {
    const start = Date.now();
    this.logger.log(`Starting full inbound sync: tenant=${tenantId}, connector=${connectorId}`);

    const connector = await this.getConnectorOrThrow(tenantId, connectorId);
    const config = connector.config as Record<string, string>;
    const schemaName = config?.schemaName;
    const tableName = config?.tableName ?? 'employees';

    if (!schemaName) {
      throw new BadRequestException('Connector config missing schemaName');
    }

    // Connect to Cloud SQL
    await this.connectToCloudSql(tenantId, connector);

    // Load field mappings for this connector
    const mappings = await this.fieldMappingService.findByConnector(tenantId, connectorId);

    try {
      // Sync roles, pages, and permissions first (they don't depend on employees)
      const roleSyncResult = await this.syncRolesAndPermissions(tenantId, schemaName);
      this.logger.log(
        `Role sync complete: roles=${roleSyncResult.roles.synced}, pages=${roleSyncResult.pages.synced}, ` +
          `permissions=${roleSyncResult.permissions.synced}, users=${roleSyncResult.users.synced}`,
      );

      // Then sync employees
      const result = await this.syncEmployees(
        tenantId,
        connectorId,
        syncJobId,
        schemaName,
        tableName,
        mappings,
      );
      return result;
    } finally {
      await this.cloudSql.disconnect();
    }
  }

  /**
   * Sync employees from Cloud SQL → PostgreSQL.
   */
  private async syncEmployees(
    tenantId: string,
    connectorId: string,
    syncJobId: string,
    schemaName: string,
    tableName: string,
    mappings: Array<{
      sourceField: string;
      targetField: string;
      transformType: string;
      transformConfig: Record<string, unknown> | unknown;
      isRequired: boolean;
      defaultValue?: string | null;
    }>,
  ): Promise<InboundSyncResult> {
    const start = Date.now();
    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const details: { id: string; status: 'synced' | 'skipped' | 'error'; reason?: string }[] = [];

    // Pre-load lookup tables for resolving numeric FK IDs → human-readable names
    const lookups = await this.loadLookupMaps(schemaName);
    this.logger.log(
      `Loaded lookup maps: functions=${lookups.functions.size}, levels=${lookups.levels.size}, ` +
        `grades=${lookups.grades.size}, designations=${lookups.designations.size}, ` +
        `cities=${lookups.cities.size}, subfunctions=${lookups.subfunctions.size}`,
    );

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      // Paginated SELECT from Cloud SQL
      const rows = await this.cloudSql.executeQuery<Record<string, unknown>>(
        schemaName,
        `SELECT * FROM \`${tableName}\` LIMIT ? OFFSET ?`,
        [BATCH_SIZE, offset],
      );

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of rows) {
        try {
          // 1. Validate with Zod (loose schema)
          const parsed = CloudSqlEmployeeRowSchema.safeParse(row);
          if (!parsed.success) {
            skipped++;
            const employeeId = String(
              row['employee_code'] ?? row['employee_id'] ?? row['id'] ?? 'unknown',
            );
            details.push({ id: employeeId, status: 'skipped', reason: parsed.error.message });
            continue;
          }

          const validRow = parsed.data;

          // Resolve the canonical employee identifier (prefer employee_code > employee_id > id)
          const employeeId = String(
            validRow.employee_code || validRow.employee_id || validRow.id || 'unknown',
          );

          // Skip rows without a usable employee identifier
          if (!employeeId || employeeId === 'unknown' || employeeId === '') {
            skipped++;
            details.push({ id: 'unknown', status: 'skipped', reason: 'No employee identifier' });
            continue;
          }

          // 2. Apply field mappings (if configured)
          let mappedData: Record<string, unknown>;
          if (mappings.length > 0) {
            const mapResult = this.fieldMappingService.applyMappings(
              validRow as unknown as Record<string, unknown>,
              mappings.map((m) => ({
                ...m,
                transformConfig: (m.transformConfig ?? {}) as Record<string, unknown>,
              })),
            );
            if (!mapResult.success && mapResult.errors.length > 0) {
              this.logger.warn(
                `Field mapping errors for ${employeeId}: ${mapResult.errors.map((e) => e.message).join(', ')}`,
              );
            }
            mappedData = mapResult.mappedData;
          } else {
            // No mappings — use direct field names with lookup resolution
            mappedData = this.defaultMapping(validRow, lookups);
          }

          // 3. Upsert into PostgreSQL
          await this.upsertEmployee(tenantId, employeeId, mappedData);
          synced++;
          details.push({ id: employeeId, status: 'synced' });
        } catch (err) {
          errors++;
          const employeeId = String(
            row['employee_code'] ?? row['employee_id'] ?? row['id'] ?? 'unknown',
          );
          const message = err instanceof Error ? err.message : 'Unknown error';
          details.push({ id: employeeId, status: 'error', reason: message.substring(0, 200) });
          this.logger.warn(`Failed to sync employee ${employeeId}: ${message}`);
        }
      }

      offset += rows.length;
      if (rows.length < BATCH_SIZE) hasMore = false;
    }

    const durationMs = Date.now() - start;

    // Update sync job record
    await this.db.forTenant(tenantId, (tx) =>
      tx.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: errors > 0 && synced === 0 ? 'FAILED' : 'COMPLETED',
          totalRecords: synced + skipped + errors,
          processedRecords: synced,
          failedRecords: errors,
          skippedRecords: skipped,
          completedAt: new Date(),
          errorMessage: errors > 0 ? `${errors} records failed` : null,
        },
      }),
    );

    // Update connector lastSyncAt
    await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.update({
        where: { id: connectorId },
        data: { lastSyncAt: new Date() },
      }),
    );

    // Create sync log entry (summary record)
    await this.db.forTenant(tenantId, (tx) =>
      tx.syncLog.create({
        data: {
          syncJobId,
          entityId: connectorId, // Use connectorId as the entity reference for summary logs
          entityType: 'employee',
          action: 'UPDATE',
          sourceData: { synced, skipped, errors, sampleDetails: details.slice(0, 50) } as never,
        },
      }),
    );

    this.logger.log(
      `Inbound sync complete: synced=${synced}, skipped=${skipped}, errors=${errors}, duration=${durationMs}ms`,
    );

    // Second pass: resolve manager relationships (employee_code → PG id)
    await this.resolveManagerRelationships(tenantId, schemaName, tableName);

    const totalDurationMs = Date.now() - start;

    return {
      syncJobId,
      entityType: 'employee',
      durationMs: totalDurationMs,
      totalRecords: synced + skipped + errors,
      processedRecords: synced,
      failedRecords: errors,
      skippedRecords: skipped,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────

  /**
   * Default field mapping when no FieldMappings are configured.
   * Maps Cloud SQL columns → camelCase Prisma Employee fields.
   *
   * Handles both standard schemas (first_name, last_name, employee_id)
   * and Compport legacy schemas (name, employee_code, login_user table).
   *
   * Uses pre-loaded lookup maps to resolve numeric FK IDs to human-readable names.
   */
  private defaultMapping(
    row: Record<string, unknown>,
    lookups: LookupMaps,
  ): Record<string, unknown> {
    // Helper: resolve a numeric FK ID using a lookup map, fallback to string
    const resolve = (map: Map<number, string>, val: unknown): string | null => {
      if (val == null || val === '' || val === 0) return null;
      const id = typeof val === 'number' ? val : Number(val);
      if (isNaN(id)) return String(val);
      return map.get(id) ?? String(val);
    };

    // Handle name: split "name" into firstName/lastName if first_name not present
    let firstName = row['first_name'] as string | null;
    let lastName = row['last_name'] as string | null;
    if (!firstName && row['name']) {
      const nameParts = String(row['name']).trim().split(/\s+/);
      firstName = nameParts[0] ?? null;
      lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;
    }

    // Handle email: Compport sometimes stores employee_code as email
    let email = row['email'] as string | null;
    if (email && !email.includes('@')) {
      // Not a real email — construct a placeholder
      email = null;
    }

    // Handle hire date: check both hire_date and company_joining_date
    // MySQL2 returns Date objects for datetime columns, so handle both Date and string
    const hireDateRaw = row['hire_date'] ?? row['company_joining_date'];
    const hireDate =
      hireDateRaw instanceof Date
        ? hireDateRaw
        : hireDateRaw
          ? new Date(String(hireDateRaw))
          : null;

    // Handle status: Compport uses numeric 1=active, others may be string
    const rawStatus = row['status'];
    let status: string;
    if (typeof rawStatus === 'number') {
      status = rawStatus === 1 ? 'active' : 'inactive';
    } else {
      status = String(rawStatus ?? 'active');
    }

    // Handle salary: check base_salary, current_base_salary, and assignment_based_salary
    // Use a helper that treats 0 / "0.00" / null as "no data" so we fall through to the next source
    const nonZero = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return isNaN(n) || n === 0 ? null : n;
    };
    const baseSalary =
      nonZero(row['base_salary']) ??
      nonZero(row['current_base_salary']) ??
      nonZero(row['assignment_based_salary']);

    // Coerce all values to appropriate Prisma types (many Compport fields are numeric FK IDs)
    const toStr = (v: unknown): string | null =>
      v != null && v !== '' && v !== 0 ? String(v) : null;

    // Strip Compport internal code suffixes like "(BFDL_BFSD_SL_SAL)" from lookup names
    const stripCodeSuffix = (name: string | null): string | null =>
      name ? name.replace(/\s*\([A-Z0-9_]+\)\s*$/, '').trim() || name : null;

    // Resolve FK IDs to human-readable names via lookup maps
    const department =
      stripCodeSuffix(resolve(lookups.functions, row['function'])) ??
      toStr(row['department']) ??
      'Unknown';
    const level =
      resolve(lookups.levels, row['level']) ?? resolve(lookups.grades, row['grade']) ?? 'Unknown';
    // City names in Compport are stored as "CityName|BranchCode" — extract just the city name
    const rawCity = resolve(lookups.cities, row['city']) ?? toStr(row['location']) ?? null;
    const location = rawCity?.split('|')[0]?.trim() ?? null;
    const jobFamily =
      stripCodeSuffix(resolve(lookups.subfunctions, row['subfunction'])) ??
      toStr(row['job_family']) ??
      null;
    const designationName = resolve(lookups.designations, row['designation']);
    const gradeName = resolve(lookups.grades, row['grade']);

    // Resolve additional lookups
    const employeeTypeName = resolve(lookups.employeeTypes, row['employee_type']);
    const employeeRoleName = resolve(lookups.employeeRoles, row['employee_role']);
    const costCenterName = resolve(lookups.costCenters, row['cost_center']);
    const countryName = resolve(lookups.countries, row['country']);
    const bl1Name = stripCodeSuffix(resolve(lookups.businessLevel1, row['business_level_1']));
    const bl2Name = stripCodeSuffix(resolve(lookups.businessLevel2, row['business_level_2']));
    const bl3Name = stripCodeSuffix(resolve(lookups.businessLevel3, row['business_level_3']));
    const educationName = resolve(lookups.educations, row['education']);
    const systemRoleName = resolve(lookups.roles, row['role']);

    // Handle termination date: Compport uses 1899-11-30 as a null sentinel
    const termDateRaw = row['termination_date'];
    let terminationDate: Date | null = null;
    if (termDateRaw != null) {
      const td = termDateRaw instanceof Date ? termDateRaw : new Date(String(termDateRaw));
      if (!isNaN(td.getTime()) && td.getFullYear() > 1900) {
        terminationDate = td;
      }
    }

    // Handle totalComp: prefer total_compensation over total_comp
    const totalCompRaw = row['total_compensation'] ?? row['total_comp'];
    const totalComp = totalCompRaw != null ? Number(totalCompRaw) : (baseSalary ?? 0);

    // Performance rating: prefer rating_for_current_year over performance_rating
    const perfRatingRaw = row['rating_for_current_year'] ?? row['performance_rating'];
    const performanceRating = perfRatingRaw != null ? Number(perfRatingRaw) : null;

    return {
      firstName: firstName ?? 'Unknown',
      lastName: lastName ?? '',
      email:
        email ??
        `${String(row['employee_code'] ?? row['employee_id'] ?? row['id'])}@imported.local`,
      department,
      jobFamily,
      level,
      hireDate: hireDate && !isNaN(hireDate.getTime()) ? hireDate : new Date('2020-01-01'),
      terminationDate,
      managerId: null, // manager_name in Compport is an employee_code, not a PG id
      gender: toStr(row['gender']),
      location,
      baseSalary: baseSalary ?? 0,
      totalComp,
      currency: typeof row['currency'] === 'string' ? row['currency'] : 'INR',
      compaRatio: row['compa_ratio'] != null ? Number(row['compa_ratio']) : null,
      performanceRating,
      isPeopleManager: row['is_manager'] === 1 || row['is_manager'] === true,
      // Store original Compport data in metadata for reference
      metadata: {
        compportId: row['id'],
        compportStatus: status,
        managerCode: row['manager_name'],
        // Designation / job
        designationId: row['designation'],
        designationName,
        jobTitle:
          designationName ??
          toStr(row['title']) ??
          toStr(row['job_title']) ??
          toStr(row['designation']),
        jobCode: toStr(row['job_code']),
        jobName: toStr(row['job_name']),
        // Grade / level IDs
        gradeId: row['grade'],
        gradeName,
        functionId: row['function'],
        functionName: resolve(lookups.functions, row['function']),
        // Geography
        cityId: row['city'],
        cityName: resolve(lookups.cities, row['city']),
        countryId: row['country'],
        countryName,
        // Hierarchy / business levels
        businessLevel1: bl1Name,
        businessLevel2: bl2Name,
        businessLevel3: bl3Name,
        // Employee classification
        employeeTypeId: row['employee_type'],
        employeeType: employeeTypeName,
        employeeRoleId: row['employee_role'],
        employeeRole: employeeRoleName,
        systemRoleId: row['role'],
        systemRole: systemRoleName,
        costCenterId: row['cost_center'],
        costCenter: costCenterName,
        educationId: row['education'],
        education: educationName,
        companyName: toStr(row['company_name']),
        // Approver chain
        approver1: toStr(row['approver_1']),
        approver2: toStr(row['approver_2']),
        approver3: toStr(row['approver_3']),
        approver4: toStr(row['approver_4']),
        // Talent flags
        criticalTalent: row['critical_talent'] != null ? Number(row['critical_talent']) : null,
        criticalPosition:
          row['critical_position'] != null ? Number(row['critical_position']) : null,
        specialCategory: row['special_category'] != null ? Number(row['special_category']) : null,
        // Tenure
        tenureCompany: row['tenure_company'] != null ? Number(row['tenure_company']) : null,
        tenureRole: row['tenure_role'] != null ? Number(row['tenure_role']) : null,
        recentlyPromoted: toStr(row['recently_promoted']),
        // Ratings
        ratingCurrentYear:
          row['rating_for_current_year'] != null ? Number(row['rating_for_current_year']) : null,
        ratingLastYear:
          row['rating_for_last_year'] != null ? Number(row['rating_for_last_year']) : null,
        // Compensation details
        targetBonus:
          row['current_target_bonus'] != null ? Number(row['current_target_bonus']) : null,
        // Termination
        terminationCategory: toStr(row['termination_category']),
        terminationReason: toStr(row['termination_reason']),
      },
    };
  }

  /**
   * Pre-load all manage_* lookup tables from Cloud SQL into memory.
   * These are small tables (10–870 rows each) used to resolve numeric FK IDs
   * in the login_user table to human-readable names.
   */
  private async loadLookupMaps(schemaName: string): Promise<LookupMaps> {
    const loadTable = async (tableName: string): Promise<Map<number, string>> => {
      try {
        const rows = await this.cloudSql.executeQuery<{ id: number; name: string }>(
          schemaName,
          `SELECT id, name FROM \`${tableName}\``,
          [],
        );
        const map = new Map<number, string>();
        for (const row of rows) {
          if (row.id != null && row.name != null) {
            map.set(Number(row.id), String(row.name));
          }
        }
        return map;
      } catch (err) {
        this.logger.warn(`Failed to load lookup table ${tableName}: ${(err as Error).message}`);
        return new Map();
      }
    };

    const [
      functions,
      levels,
      grades,
      designations,
      cities,
      subfunctions,
      employeeRoles,
      employeeTypes,
      costCenters,
      countries,
      businessLevel1,
      businessLevel2,
      businessLevel3,
      educations,
      roles,
    ] = await Promise.all([
      loadTable('manage_function'),
      loadTable('manage_level'),
      loadTable('manage_grade'),
      loadTable('manage_designation'),
      loadTable('manage_city'),
      loadTable('manage_subfunction'),
      loadTable('manage_employee_role'),
      loadTable('manage_employee_type'),
      loadTable('manage_cost_center'),
      loadTable('manage_country'),
      loadTable('manage_business_level_1'),
      loadTable('manage_business_level_2'),
      loadTable('manage_business_level_3'),
      loadTable('manage_education'),
      loadTable('manage_role'),
    ]);

    return {
      functions,
      levels,
      grades,
      designations,
      cities,
      subfunctions,
      employeeRoles,
      employeeTypes,
      costCenters,
      countries,
      businessLevel1,
      businessLevel2,
      businessLevel3,
      educations,
      roles,
    };
  }

  /**
   * Second pass: resolve manager_name (employee_code) → PG Employee.id.
   *
   * 1. Build employeeCode → PG id map from PostgreSQL
   * 2. Query Cloud SQL for employee_code → manager_name pairs
   * 3. Batch-update managerId for each employee
   */
  private async resolveManagerRelationships(
    tenantId: string,
    schemaName: string,
    tableName: string,
  ): Promise<void> {
    const start = Date.now();

    // Step 1: Build employeeCode → PG id map
    const employees = await this.db.forTenant(tenantId, (tx) =>
      tx.employee.findMany({
        where: { tenantId },
        select: { id: true, employeeCode: true },
      }),
    );
    const codeToId = new Map<string, string>();
    for (const emp of employees) {
      codeToId.set(emp.employeeCode, emp.id);
    }

    // Step 2: Query Cloud SQL for employee_code → manager_name pairs
    let offset = 0;
    let hasMore = true;
    let resolved = 0;
    let unresolved = 0;
    let selfRef = 0;
    let noManager = 0;

    while (hasMore) {
      const rows = await this.cloudSql.executeQuery<{
        employee_code: string;
        manager_name: string | null;
      }>(schemaName, `SELECT employee_code, manager_name FROM \`${tableName}\` LIMIT ? OFFSET ?`, [
        BATCH_SIZE,
        offset,
      ]);

      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      // Step 3: Batch-update managerId
      for (const row of rows) {
        const empCode = String(row.employee_code);
        const mgrCode = row.manager_name ? String(row.manager_name).trim() : null;

        if (!mgrCode || mgrCode === '' || mgrCode === '0') {
          noManager++;
          continue;
        }

        // Skip self-referencing managers
        if (mgrCode === empCode) {
          selfRef++;
          continue;
        }

        const employeeId = codeToId.get(empCode);
        const managerId = codeToId.get(mgrCode);

        if (!employeeId) continue; // Employee not in PG (shouldn't happen)

        if (managerId) {
          try {
            await this.db.forTenant(tenantId, (tx) =>
              tx.employee.update({
                where: { id: employeeId },
                data: { managerId },
              }),
            );
            resolved++;
          } catch (err) {
            this.logger.warn(`Failed to set manager for ${empCode}: ${(err as Error).message}`);
          }
        } else {
          unresolved++;
        }
      }

      offset += rows.length;
      if (rows.length < BATCH_SIZE) hasMore = false;
    }

    const duration = Date.now() - start;
    this.logger.log(
      `Manager resolution: resolved=${resolved}, unresolved=${unresolved}, ` +
        `selfRef=${selfRef}, noManager=${noManager}, duration=${duration}ms`,
    );
  }

  /**
   * Upsert an employee into PostgreSQL.
   * Match on tenantId + employeeCode (unique per tenant).
   */
  private async upsertEmployee(
    tenantId: string,
    employeeCode: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.db.forTenant(tenantId, (tx) =>
      tx.employee.upsert({
        where: {
          tenantId_employeeCode: { tenantId, employeeCode },
        },
        create: {
          tenantId,
          employeeCode,
          ...data,
        } as never,
        update: data as never,
      }),
    );
  }

  /**
   * Sync roles, pages, and role_permissions from Compport Cloud SQL into
   * CompportIQ's TenantRole, TenantPage, and TenantRolePermission tables.
   *
   * Also syncs login_user records: updates User.role with the actual Compport
   * role ID and links User ↔ Employee via employee_code.
   *
   * Assumes Cloud SQL connection is already established.
   */
  async syncRolesAndPermissions(tenantId: string, schemaName: string): Promise<RoleSyncResult> {
    const start = Date.now();
    const result: RoleSyncResult = {
      roles: { synced: 0, errors: 0 },
      pages: { synced: 0, errors: 0 },
      permissions: { synced: 0, errors: 0 },
      users: { synced: 0, linked: 0, errors: 0 },
      durationMs: 0,
    };

    // ── Step 1: Sync roles ─────────────────────────────────────
    try {
      const rows = await this.cloudSql.executeQuery<{
        role_pk_id: number;
        id: string;
        name: string;
        module: string | null;
      }>(schemaName, 'SELECT role_pk_id, id, name, module FROM `roles`');

      for (const row of rows) {
        try {
          const compportRoleId = String(row.id).trim();
          await this.db.forTenant(tenantId, (tx) =>
            tx.tenantRole.upsert({
              where: { tenantId_compportRoleId: { tenantId, compportRoleId } },
              create: {
                tenantId,
                compportRoleId,
                name: String(row.name ?? '').trim(),
                module: row.module ? String(row.module).trim() : null,
                isActive: true,
                syncedAt: new Date(),
              },
              update: {
                name: String(row.name ?? '').trim(),
                module: row.module ? String(row.module).trim() : null,
                isActive: true,
                syncedAt: new Date(),
              },
            }),
          );
          result.roles.synced++;
        } catch (err) {
          result.roles.errors++;
          this.logger.warn(`Failed to sync role ${row.id}: ${(err as Error).message}`);
        }
      }
      this.logger.log(`Roles synced: ${result.roles.synced} ok, ${result.roles.errors} errors`);
    } catch (err) {
      this.logger.warn(`Failed to load roles table: ${(err as Error).message}`);
    }

    // ── Step 2: Sync pages ─────────────────────────────────────
    try {
      const rows = await this.cloudSql.executeQuery<{
        id: number;
        name: string;
        uri_segment: string | null;
        type: string | null;
        status: string | null;
      }>(schemaName, 'SELECT id, name, uri_segment, type, status FROM `pages`');

      for (const row of rows) {
        try {
          const compportPageId = String(row.id);
          await this.db.forTenant(tenantId, (tx) =>
            tx.tenantPage.upsert({
              where: { tenantId_compportPageId: { tenantId, compportPageId } },
              create: {
                tenantId,
                compportPageId,
                name: String(row.name ?? '').trim(),
                uriSegment: row.uri_segment ? String(row.uri_segment) : null,
                pageType: row.type ? String(row.type) : null,
                status: row.status ? String(row.status) : null,
                syncedAt: new Date(),
              },
              update: {
                name: String(row.name ?? '').trim(),
                uriSegment: row.uri_segment ? String(row.uri_segment) : null,
                pageType: row.type ? String(row.type) : null,
                status: row.status ? String(row.status) : null,
                syncedAt: new Date(),
              },
            }),
          );
          result.pages.synced++;
        } catch (err) {
          result.pages.errors++;
          this.logger.warn(`Failed to sync page ${row.id}: ${(err as Error).message}`);
        }
      }
      this.logger.log(`Pages synced: ${result.pages.synced} ok, ${result.pages.errors} errors`);
    } catch (err) {
      this.logger.warn(`Failed to load pages table: ${(err as Error).message}`);
    }

    // ── Step 3: Sync role_permissions ───────────────────────────
    // Build lookup maps: compportRoleId → TenantRole.id, compportPageId → TenantPage.id
    const roleMap = new Map<string, string>();
    const pageMap = new Map<string, string>();

    await this.db.forTenant(tenantId, async (tx) => {
      const roles = await tx.tenantRole.findMany({
        where: { tenantId },
        select: { id: true, compportRoleId: true },
      });
      for (const r of roles) roleMap.set(r.compportRoleId, r.id);

      const pages = await tx.tenantPage.findMany({
        where: { tenantId },
        select: { id: true, compportPageId: true },
      });
      for (const p of pages) pageMap.set(p.compportPageId, p.id);
    });

    try {
      const rows = await this.cloudSql.executeQuery<{
        role_id: string;
        page_id: number;
        view: number;
        insert: number;
        update: number;
        delete: number;
      }>(
        schemaName,
        'SELECT role_id, page_id, `view`, `insert`, `update`, `delete` FROM `role_permissions`',
      );

      for (const row of rows) {
        try {
          const compportRoleId = String(row.role_id).trim();
          const compportPageId = String(row.page_id);
          const roleId = roleMap.get(compportRoleId);
          const pageId = pageMap.get(compportPageId);

          if (!roleId || !pageId) {
            // Role or page not found — skip (may not have synced yet)
            continue;
          }

          await this.db.forTenant(tenantId, (tx) =>
            tx.tenantRolePermission.upsert({
              where: { tenantId_roleId_pageId: { tenantId, roleId, pageId } },
              create: {
                tenantId,
                roleId,
                pageId,
                canView: row.view === 1,
                canInsert: row.insert === 1,
                canUpdate: row.update === 1,
                canDelete: row.delete === 1,
                syncedAt: new Date(),
              },
              update: {
                canView: row.view === 1,
                canInsert: row.insert === 1,
                canUpdate: row.update === 1,
                canDelete: row.delete === 1,
                syncedAt: new Date(),
              },
            }),
          );
          result.permissions.synced++;
        } catch (err) {
          result.permissions.errors++;
          this.logger.warn(`Failed to sync permission: ${(err as Error).message}`);
        }
      }
      this.logger.log(
        `Permissions synced: ${result.permissions.synced} ok, ${result.permissions.errors} errors`,
      );
    } catch (err) {
      this.logger.warn(`Failed to load role_permissions table: ${(err as Error).message}`);
    }

    // ── Step 4: Sync login_user → User records ─────────────────
    try {
      const rows = await this.cloudSql.executeQuery<{
        employee_code: string;
        role: string;
        email: string | null;
        name: string | null;
        is_people_manager: number | null;
      }>(
        schemaName,
        'SELECT employee_code, role, email, name, is_people_manager FROM `login_user`',
      );

      for (const row of rows) {
        try {
          const employeeCode = String(row.employee_code).trim();
          const roleId = String(row.role).trim();
          const email = row.email ? String(row.email).trim() : `${employeeCode}@compport.local`;
          const name = row.name ? String(row.name).trim() : employeeCode;

          // Upsert user with actual Compport role ID
          const user = await this.db.forTenant(tenantId, (tx) =>
            tx.user.upsert({
              where: { tenantId_email: { tenantId, email } },
              create: {
                tenantId,
                email,
                name,
                role: roleId,
                passwordHash: '', // No password — SSO only
              },
              update: {
                name,
                role: roleId,
              },
              select: { id: true },
            }),
          );
          result.users.synced++;

          // Link User → Employee via employee_code
          const employee = await this.db.forTenant(tenantId, (tx) =>
            tx.employee.findFirst({
              where: { tenantId, employeeCode },
              select: { id: true },
            }),
          );

          if (employee) {
            await this.db.forTenant(tenantId, (tx) =>
              tx.user.update({
                where: { id: user.id },
                data: { employeeId: employee.id },
              }),
            );
            result.users.linked++;
          }
        } catch (err) {
          result.users.errors++;
          this.logger.warn(
            `Failed to sync login_user ${row.employee_code}: ${(err as Error).message}`,
          );
        }
      }
      this.logger.log(
        `Users synced: ${result.users.synced} ok, ${result.users.linked} linked, ${result.users.errors} errors`,
      );
    } catch (err) {
      this.logger.warn(`Failed to load login_user table: ${(err as Error).message}`);
    }

    result.durationMs = Date.now() - start;
    this.logger.log(`Role & permission sync complete in ${result.durationMs}ms`);
    return result;
  }

  private async getConnectorOrThrow(tenantId: string, connectorId: string) {
    const connector = await this.db.forTenant(tenantId, (tx) =>
      tx.integrationConnector.findFirst({
        where: { id: connectorId, tenantId },
      }),
    );
    if (!connector) throw new NotFoundException(`Connector ${connectorId} not found`);
    return connector;
  }

  private async connectToCloudSql(
    tenantId: string,
    connector: {
      encryptedCredentials: string | null;
      credentialIv: string | null;
      credentialTag: string | null;
    },
  ) {
    if (!connector.encryptedCredentials || !connector.credentialIv || !connector.credentialTag) {
      throw new BadRequestException('Connector has no stored credentials');
    }

    const creds = this.credentialVault.decrypt(
      tenantId,
      connector.encryptedCredentials,
      connector.credentialIv,
      connector.credentialTag,
    );

    await this.cloudSql.connect({
      host: creds['host'] as string,
      port: (creds['port'] as number) ?? 3306,
      user: creds['user'] as string,
      password: creds['password'] as string,
      database: creds['database'] as string | undefined,
      sslCa: process.env['MYSQL_CA_CERT'],
      sslCert: process.env['MYSQL_CLIENT_CERT'],
      sslKey: process.env['MYSQL_CLIENT_KEY'],
    });
  }
}
