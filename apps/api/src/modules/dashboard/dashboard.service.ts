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
}
