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
    const [
      totalEmployees,
      activeCycles,
      complianceScore,
      pendingAnomalies,
      recentImports,
      recentActivity,
    ] = await Promise.all([
      this.getEmployeeCount(tenantId),
      this.getActiveCycleCount(tenantId),
      this.getLatestComplianceScore(tenantId),
      this.getPendingAnomalyCount(tenantId),
      this.getRecentImportCount(tenantId),
      this.getRecentActivity(tenantId),
    ]);

    return {
      totalEmployees,
      activeCycles,
      complianceScore,
      pendingAnomalies,
      recentImports,
      recentActivity,
    };
  }

  private async getEmployeeCount(tenantId: string): Promise<number> {
    return this.db.client.employee.count({
      where: { tenantId, terminationDate: null },
    });
  }

  private async getActiveCycleCount(tenantId: string): Promise<number> {
    return this.db.client.compCycle.count({
      where: { tenantId, status: 'ACTIVE' },
    });
  }

  private async getLatestComplianceScore(tenantId: string): Promise<number | null> {
    const scan = await this.db.client.complianceScan.findFirst({
      where: { tenantId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { overallScore: true },
    });
    return scan?.overallScore ?? null;
  }

  private async getPendingAnomalyCount(tenantId: string): Promise<number> {
    return this.db.client.payrollAnomaly.count({
      where: {
        resolved: false,
        payrollRun: { tenantId },
      },
    });
  }

  private async getRecentImportCount(tenantId: string): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return this.db.client.importJob.count({
      where: {
        tenantId,
        createdAt: { gte: thirtyDaysAgo },
      },
    });
  }

  private async getRecentActivity(tenantId: string): Promise<ActivityEntry[]> {
    const logs = await this.db.client.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        user: { select: { name: true } },
      },
    });

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      userName: log.user?.name ?? null,
      createdAt: log.createdAt,
    }));
  }
}

