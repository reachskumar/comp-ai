import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database';

export interface DashboardSummary {
  totalEmployees: number;
  activeCycles: number;
  complianceScore: number | null;
  pendingAnomalies: number;
  recentImports: number;
  recentActivity: ActivityEntry[];
}

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userName: string | null;
  createdAt: Date;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly db: DatabaseService) {}

  async getSummary(tenantId: string): Promise<DashboardSummary> {
    // Single forTenant transaction for ALL dashboard queries
    try {
      const [employees, cycles, scan, anomalies, imports, logs] = await this.db.forTenant(
        tenantId,
        (tx) =>
          Promise.all([
            tx.employee.count({ where: { tenantId, terminationDate: null } }),
            tx.compCycle.count({ where: { tenantId, status: 'ACTIVE' } }),
            tx.complianceScan.findFirst({
              where: { tenantId, status: 'COMPLETED' },
              orderBy: { completedAt: 'desc' },
              select: { overallScore: true },
            }),
            tx.payrollAnomaly.count({
              where: { resolved: false, payrollRun: { tenantId } },
            }),
            tx.importJob.count({
              where: {
                tenantId,
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
            }),
            tx.auditLog.findMany({
              where: { tenantId },
              orderBy: { createdAt: 'desc' },
              take: 5,
              include: { user: { select: { name: true } } },
            }),
          ]),
      );

      return {
        totalEmployees: employees,
        activeCycles: cycles,
        complianceScore: scan?.overallScore ?? null,
        pendingAnomalies: anomalies,
        recentImports: imports,
        recentActivity: logs.map((l) => ({
          id: l.id,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          userName: l.user?.name ?? null,
          createdAt: l.createdAt,
        })),
      };
    } catch (err) {
      this.logger.warn(`Dashboard query failed for tenant=${tenantId}: ${err}`);
      return {
        totalEmployees: 0,
        activeCycles: 0,
        complianceScore: null,
        pendingAnomalies: 0,
        recentImports: 0,
        recentActivity: [],
      };
    }
  }

  /**
   * Latest full-sync job for the tenant. Returns null if there is no
   * recent sync (nothing to display). The tenant UI polls this every 3s
   * while a sync is running and shows a live progress banner.
   */
  async getCurrentSyncStatus(tenantId: string): Promise<{
    id: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    phase: string | null;
    processedRecords: number;
    totalRecords: number;
    failedRecords: number;
    startedAt: Date | null;
    completedAt: Date | null;
    errorMessage: string | null;
  } | null> {
    try {
      // Only return jobs the user should care about:
      //  - RUNNING/PENDING AND started within last 30 min → active sync
      //  - COMPLETED/FAILED within last 5 min → flash result then dismiss
      //  - Anything older → stale, don't show (prevents stuck banners from
      //    crashed syncs that never set status=COMPLETED)
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

      const job = await this.db.forTenant(tenantId, (tx) =>
        tx.syncJob.findFirst({
          where: {
            tenantId,
            entityType: 'full_sync',
            OR: [
              {
                status: { in: ['PENDING', 'RUNNING'] },
                startedAt: { gte: thirtyMinAgo },
              },
              { completedAt: { gte: fiveMinAgo } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            metadata: true,
            processedRecords: true,
            totalRecords: true,
            failedRecords: true,
            startedAt: true,
            completedAt: true,
            errorMessage: true,
          },
        }),
      );
      if (!job) return null;

      const meta = (job.metadata as Record<string, unknown> | null) ?? {};
      const phase = typeof meta['phase'] === 'string' ? (meta['phase'] as string) : null;

      return {
        id: job.id,
        status: job.status,
        phase,
        processedRecords: job.processedRecords,
        totalRecords: job.totalRecords,
        failedRecords: job.failedRecords,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        errorMessage: job.errorMessage,
      };
    } catch (err) {
      this.logger.warn(`getCurrentSyncStatus failed for tenant=${tenantId}: ${err}`);
      return null;
    }
  }
}
