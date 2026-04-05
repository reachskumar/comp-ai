import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CompportCloudSqlService } from './compport-cloudsql.service';
import { TenantRegistryService, CompportTenantInfo } from './tenant-registry.service';
import { SchemaDiscoveryService } from './schema-discovery.service';

// ─── Compport Module Detection ────────────────────────────

/**
 * Maps Compport Cloud SQL table names to product modules.
 * Used to detect which Compport modules a customer has enabled.
 */
const TABLE_TO_MODULE: Record<string, string> = {
  employees: 'Core HR',
  compensation: 'Compensation',
  comp_cycles: 'Comp Cycles',
  salary_structures: 'Salary Structures',
  salary_bands: 'Salary Bands',
  benefits: 'Benefits',
  benefit_plans: 'Benefits',
  bonus: 'Bonus',
  bonus_plans: 'Bonus',
  equity: 'Equity',
  equity_grants: 'Equity',
  stock_options: 'Equity',
  performance: 'Performance',
  performance_ratings: 'Performance',
  goals: 'Performance',
  surveys: 'Surveys',
  survey_responses: 'Surveys',
  letters: 'Letters',
  offer_letters: 'Letters',
  payroll: 'Payroll',
  payroll_runs: 'Payroll',
  budgets: 'Budget Planning',
  budget_allocations: 'Budget Planning',
  merit_matrices: 'Merit Matrix',
  job_architecture: 'Job Architecture',
  job_families: 'Job Architecture',
  job_levels: 'Job Architecture',
  career_ladders: 'Job Architecture',
  benchmarking: 'Benchmarking',
  market_data: 'Benchmarking',
  policies: 'Policies',
  policy_documents: 'Policies',
  audit_logs: 'Audit',
  reports: 'Reports',
  dashboards: 'Analytics',
  analytics: 'Analytics',
  integrations: 'Integrations',
  users: 'User Management',
  roles: 'User Management',
  departments: 'Organization',
  locations: 'Organization',
  cost_centers: 'Organization',
};

// ─── Types ────────────────────────────────────────────────

export interface TenantSyncOverview {
  tenantId: string;
  tenantName: string;
  slug: string;
  compportSchema: string | null;
  isActive: boolean;
  plan: string;
  connectorStatus: 'connected' | 'disconnected' | 'error' | 'not_configured';
  lastSyncAt: Date | null;
  nextSyncDue: string | null;
  syncSchedule: string | null;
  employees: { total: number; synced: number; lastSyncCount: number };
  writeBack: { totalBatches: number; applied: number; pending: number; failed: number };
  compportModules: string[];
  connectionHealthy: boolean;
}

export interface PlatformIntegrationStats {
  connection: {
    primaryConnected: boolean;
    cachedPools: number;
    maxPools: number;
  };
  tenants: {
    total: number;
    connected: number;
    synced: number;
    neverSynced: number;
    withErrors: number;
  };
  sync: {
    totalJobsToday: number;
    completedToday: number;
    failedToday: number;
    totalRecordsSynced: number;
  };
  writeBack: {
    totalBatches: number;
    appliedBatches: number;
    pendingBatches: number;
    failedBatches: number;
    totalRecordsWritten: number;
  };
  compportTenantsDiscovered: number;
}

@Injectable()
export class IntegrationDashboardService {
  private readonly logger = new Logger(IntegrationDashboardService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cloudSql: CompportCloudSqlService,
    private readonly tenantRegistry: TenantRegistryService,
    private readonly schemaDiscovery: SchemaDiscoveryService,
  ) {}

  /**
   * Platform-wide integration statistics for the admin dashboard.
   */
  async getPlatformStats(): Promise<PlatformIntegrationStats> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      totalTenants,
      connectedTenants,
      syncedTenants,
      totalSyncJobsToday,
      completedSyncToday,
      failedSyncToday,
      totalBatches,
      appliedBatches,
      pendingBatches,
      failedBatches,
    ] = await Promise.all([
      this.db.client.tenant.count(),
      this.db.client.integrationConnector.count({
        where: { status: 'ACTIVE', connectorType: { in: ['COMPPORT_CLOUDSQL', 'HRIS'] } },
      }),
      this.db.client.integrationConnector.count({
        where: { lastSyncAt: { not: null } },
      }),
      this.db.client.syncJob.count({
        where: { createdAt: { gte: todayStart } },
      }),
      this.db.client.syncJob.count({
        where: { createdAt: { gte: todayStart }, status: 'COMPLETED' },
      }),
      this.db.client.syncJob.count({
        where: { createdAt: { gte: todayStart }, status: 'FAILED' },
      }),
      this.db.client.writeBackBatch.count(),
      this.db.client.writeBackBatch.count({ where: { status: 'APPLIED' } }),
      this.db.client.writeBackBatch.count({
        where: { status: { in: ['PENDING_REVIEW', 'PREVIEWED', 'DRY_RUN_PASSED'] } },
      }),
      this.db.client.writeBackBatch.count({
        where: { status: { in: ['FAILED', 'ROLLBACK_FAILED'] } },
      }),
    ]);

    // Count total synced records
    const syncAgg = await this.db.client.syncJob.aggregate({
      _sum: { processedRecords: true },
    });

    // Count total write-back records applied
    const wbAgg = await this.db.client.writeBackBatch.aggregate({
      _sum: { appliedRecords: true },
    });

    // Try to discover Compport tenants (may fail if not connected)
    let compportTenantsDiscovered = 0;
    try {
      if (this.cloudSql.isConnected) {
        const discovered = await this.tenantRegistry.discoverTenants();
        compportTenantsDiscovered = discovered.length;
      }
    } catch {
      // Not connected or platform_admin_db not accessible
    }

    const poolStatus = this.cloudSql.getPoolStatus();

    return {
      connection: {
        primaryConnected: poolStatus.primaryConnected,
        cachedPools: poolStatus.cachedPools,
        maxPools: poolStatus.maxPools,
      },
      tenants: {
        total: totalTenants,
        connected: connectedTenants,
        synced: syncedTenants,
        neverSynced: connectedTenants - syncedTenants,
        withErrors: failedSyncToday,
      },
      sync: {
        totalJobsToday: totalSyncJobsToday,
        completedToday: completedSyncToday,
        failedToday: failedSyncToday,
        totalRecordsSynced: syncAgg._sum.processedRecords ?? 0,
      },
      writeBack: {
        totalBatches,
        appliedBatches,
        pendingBatches,
        failedBatches,
        totalRecordsWritten: wbAgg._sum.appliedRecords ?? 0,
      },
      compportTenantsDiscovered,
    };
  }

  /**
   * Per-tenant sync overview for the admin dashboard.
   * Shows sync status, data counts, modules, and connection health.
   */
  async getTenantSyncOverviews(page = 1, limit = 20, search?: string): Promise<{
    data: TenantSyncOverview[];
    total: number;
    page: number;
    limit: number;
  }> {
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (search) {
      where['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [tenants, total] = await Promise.all([
      this.db.client.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { employees: true } },
        },
      }),
      this.db.client.tenant.count({ where }),
    ]);

    const overviews: TenantSyncOverview[] = [];

    for (const tenant of tenants) {
      // Get connector for this tenant
      const connector = await this.db.client.integrationConnector.findFirst({
        where: {
          tenantId: tenant.id,
          connectorType: { in: ['COMPPORT_CLOUDSQL', 'HRIS'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Get latest sync job
      const latestSync = connector
        ? await this.db.client.syncJob.findFirst({
            where: { connectorId: connector.id },
            orderBy: { createdAt: 'desc' },
            select: { status: true, processedRecords: true, completedAt: true },
          })
        : null;

      // Get write-back stats
      const [wbTotal, wbApplied, wbPending, wbFailed] = await Promise.all([
        this.db.client.writeBackBatch.count({ where: { tenantId: tenant.id } }),
        this.db.client.writeBackBatch.count({ where: { tenantId: tenant.id, status: 'APPLIED' } }),
        this.db.client.writeBackBatch.count({
          where: {
            tenantId: tenant.id,
            status: { in: ['PENDING_REVIEW', 'PREVIEWED', 'DRY_RUN_PASSED'] },
          },
        }),
        this.db.client.writeBackBatch.count({
          where: { tenantId: tenant.id, status: { in: ['FAILED', 'ROLLBACK_FAILED'] } },
        }),
      ]);

      // Determine connector status
      let connectorStatus: TenantSyncOverview['connectorStatus'] = 'not_configured';
      if (connector) {
        connectorStatus = connector.status === 'ACTIVE' ? 'connected' : 'error';
        if (connector.status === 'INACTIVE') connectorStatus = 'disconnected';
      }

      // Check cached pool health for this connector
      let connectionHealthy = false;
      if (connector) {
        const poolStatus = this.cloudSql.getPoolStatus();
        const pool = poolStatus.pools.find((p) => p.connectorId === connector.id);
        connectionHealthy = pool?.healthy ?? false;
      }

      // Detect Compport modules from schema (cached — don't call Cloud SQL per tenant)
      const compportModules: string[] = [];
      // Module detection is done separately via discoverTenantModules()

      overviews.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        slug: tenant.slug,
        compportSchema: tenant.compportSchema,
        isActive: tenant.isActive,
        plan: tenant.plan,
        connectorStatus,
        lastSyncAt: connector?.lastSyncAt ?? null,
        nextSyncDue: connector?.syncSchedule === 'DAILY'
          ? this.getNextSyncDue(connector.lastSyncAt as Date | null)
          : null,
        syncSchedule: connector?.syncSchedule ?? null,
        employees: {
          total: (tenant as unknown as { _count: { employees: number } })._count.employees,
          synced: latestSync?.processedRecords ?? 0,
          lastSyncCount: latestSync?.processedRecords ?? 0,
        },
        writeBack: {
          totalBatches: wbTotal,
          applied: wbApplied,
          pending: wbPending,
          failed: wbFailed,
        },
        compportModules,
        connectionHealthy,
      });
    }

    return { data: overviews, total, page, limit };
  }

  /**
   * Discover which Compport modules a specific tenant has by inspecting their Cloud SQL tables.
   */
  async discoverTenantModules(schemaName: string): Promise<{
    schemaName: string;
    modules: string[];
    tableCount: number;
    tables: string[];
  }> {
    const tables = await this.schemaDiscovery.discoverTables(schemaName);

    const detectedModules = new Set<string>();
    for (const table of tables) {
      const normalizedTable = table.toLowerCase();
      const module = TABLE_TO_MODULE[normalizedTable];
      if (module) detectedModules.add(module);
    }

    return {
      schemaName,
      modules: [...detectedModules].sort(),
      tableCount: tables.length,
      tables,
    };
  }

  /**
   * Get sync history for a specific tenant.
   */
  async getTenantSyncHistory(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const connectors = await this.db.client.integrationConnector.findMany({
      where: { tenantId },
      select: { id: true },
    });

    const connectorIds = connectors.map((c) => c.id);

    const [jobs, total] = await Promise.all([
      this.db.client.syncJob.findMany({
        where: { connectorId: { in: connectorIds } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          connectorId: true,
          direction: true,
          entityType: true,
          status: true,
          totalRecords: true,
          processedRecords: true,
          failedRecords: true,
          skippedRecords: true,
          errorMessage: true,
          createdAt: true,
          completedAt: true,
        },
      }),
      this.db.client.syncJob.count({
        where: { connectorId: { in: connectorIds } },
      }),
    ]);

    return { data: jobs, total, page, limit };
  }

  /**
   * Compport tenant discovery — show which Compport tenants exist but aren't onboarded yet.
   */
  async getOnboardingStatus(): Promise<{
    compportTenants: Array<CompportTenantInfo & { onboarded: boolean; aiTenantId: string | null }>;
    totalCompport: number;
    totalOnboarded: number;
    totalPending: number;
  }> {
    // Discover all Compport tenants
    const compportTenants = await this.tenantRegistry.discoverTenants();

    // Get all AI platform tenants with compportSchema
    const aiTenants = await this.db.client.tenant.findMany({
      where: { compportSchema: { not: null } },
      select: { id: true, compportSchema: true },
    });

    const schemaToTenantId = new Map<string, string>();
    for (const t of aiTenants) {
      if (t.compportSchema) schemaToTenantId.set(t.compportSchema, t.id);
    }

    const enriched = compportTenants.map((ct) => ({
      ...ct,
      onboarded: schemaToTenantId.has(ct.schemaName),
      aiTenantId: schemaToTenantId.get(ct.schemaName) ?? null,
    }));

    return {
      compportTenants: enriched,
      totalCompport: compportTenants.length,
      totalOnboarded: enriched.filter((t) => t.onboarded).length,
      totalPending: enriched.filter((t) => !t.onboarded).length,
    };
  }

  private getNextSyncDue(lastSyncAt: Date | null): string | null {
    if (!lastSyncAt) return 'now';
    const next = new Date(lastSyncAt);
    next.setDate(next.getDate() + 1);
    next.setHours(2, 0, 0, 0); // Default sync time: 2am
    return next.toISOString();
  }
}
