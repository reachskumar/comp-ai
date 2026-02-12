import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../../database';
import type {
  BudgetDriftResult,
  DepartmentDrift,
  BudgetProjection,
  MonitorAlert,
} from './types';

const DEFAULT_DRIFT_THRESHOLD_PCT = 5;

@Injectable()
export class BudgetDriftService {
  private readonly logger = new Logger(BudgetDriftService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Detect budget drift for a cycle.
   * Compares allocated vs committed per department/manager.
   * Flags when drift exceeds configurable threshold.
   */
  async detect(
    tenantId: string,
    cycleId: string,
    thresholdPct = DEFAULT_DRIFT_THRESHOLD_PCT,
  ): Promise<BudgetDriftResult> {
    const cycle = await this.db.client.compCycle.findFirst({
      where: { id: cycleId, tenantId },
      include: { budgets: true },
    });

    if (!cycle) {
      throw new Error(`Cycle ${cycleId} not found`);
    }

    const budgetTotal = Number(cycle.budgetTotal);
    const _totalAllocated = cycle.budgets.reduce(
      (sum, b) => sum + Number(b.allocated),
      0,
    );
    const totalSpent = cycle.budgets.reduce(
      (sum, b) => sum + Number(b.spent),
      0,
    );

    const overallDriftPct =
      budgetTotal > 0
        ? Math.round(((totalSpent - budgetTotal) / budgetTotal) * 10000) / 100
        : 0;

    const departmentDrifts: DepartmentDrift[] = cycle.budgets.map((b) => {
      const allocated = Number(b.allocated);
      const spent = Number(b.spent);
      const remaining = Number(b.remaining);
      const driftPct =
        allocated > 0
          ? Math.round(((spent - allocated) / allocated) * 10000) / 100
          : 0;

      return {
        department: b.department,
        managerId: b.managerId,
        allocated,
        spent,
        remaining,
        driftPct,
        exceeded: Math.abs(driftPct) > thresholdPct,
      };
    });

    const projection = this.computeProjection(cycle, totalSpent);

    const result: BudgetDriftResult = {
      cycleId,
      overallDriftPct,
      thresholdPct,
      exceeded: Math.abs(overallDriftPct) > thresholdPct,
      departmentDrifts,
      projection,
    };

    this.logger.log(
      `Budget drift for cycle ${cycleId}: ${overallDriftPct}% (threshold: ${thresholdPct}%)`,
    );

    return result;
  }

  /**
   * Create alerts for budget drift violations.
   */
  async createAlerts(
    tenantId: string,
    cycleId: string,
    result: BudgetDriftResult,
  ): Promise<MonitorAlert[]> {
    const alerts: MonitorAlert[] = [];

    if (result.exceeded) {
      alerts.push({
        cycleId,
        alertType: 'BUDGET_DRIFT',
        severity: Math.abs(result.overallDriftPct) > 10 ? 'CRITICAL' : 'HIGH',
        title: `Overall budget drift: ${result.overallDriftPct}%`,
        details: {
          overallDriftPct: result.overallDriftPct,
          thresholdPct: result.thresholdPct,
          projection: result.projection,
        },
      });
    }

    for (const dept of result.departmentDrifts) {
      if (dept.exceeded) {
        alerts.push({
          cycleId,
          alertType: 'BUDGET_DRIFT',
          severity: Math.abs(dept.driftPct) > 10 ? 'HIGH' : 'MEDIUM',
          title: `${dept.department} budget drift: ${dept.driftPct}%`,
          details: {
            department: dept.department,
            managerId: dept.managerId,
            allocated: dept.allocated,
            spent: dept.spent,
            driftPct: dept.driftPct,
          },
        });
      }
    }

    // Persist alerts as Notifications
    await this.persistAlerts(tenantId, cycleId, alerts);

    return alerts;
  }

  private computeProjection(
    cycle: { startDate: Date; endDate: Date; budgetTotal: unknown },
    totalSpent: number,
  ): BudgetProjection {
    const now = new Date();
    const start = new Date(cycle.startDate);
    const end = new Date(cycle.endDate);
    const budgetTotal = Number(cycle.budgetTotal);

    const totalDays = Math.max(
      1,
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
    );
    const daysElapsed = Math.max(
      1,
      (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
    );
    const daysRemaining = Math.max(
      0,
      (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    const dailyBurnRate = totalSpent / daysElapsed;
    const projectedTotal = dailyBurnRate * totalDays;
    const projectedOverage = projectedTotal - budgetTotal;

    return {
      projectedTotal: Math.round(projectedTotal * 100) / 100,
      budgetTotal,
      projectedOverage: Math.round(projectedOverage * 100) / 100,
      daysRemaining: Math.round(daysRemaining),
      dailyBurnRate: Math.round(dailyBurnRate * 100) / 100,
    };
  }

  private async persistAlerts(
    tenantId: string,
    cycleId: string,
    alerts: MonitorAlert[],
  ): Promise<void> {
    // Find an admin user to associate notifications with
    const adminUser = await this.db.client.user.findFirst({
      where: { tenantId, role: 'ADMIN' },
      select: { id: true },
    });

    if (!adminUser) {
      this.logger.warn(`No admin user found for tenant ${tenantId}, skipping alert persistence`);
      return;
    }

    for (const alert of alerts) {
      await this.db.client.notification.create({
        data: {
          tenantId,
          userId: adminUser.id,
          type: alert.alertType,
          title: alert.title,
          body: `Severity: ${alert.severity}`,
          metadata: {
            cycleId,
            alertType: alert.alertType,
            severity: alert.severity,
            ...alert.details,
          } as never,
        },
      });
    }
  }
}

