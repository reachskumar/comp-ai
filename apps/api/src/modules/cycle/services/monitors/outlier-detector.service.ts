import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../../database';
import type {
  OutlierRecord,
  OutlierResult,
  MonitorAlert,
  AlertSeverity,
  OutlierType,
} from './types';

const Z_SCORE_THRESHOLD = 2;

@Injectable()
export class OutlierDetectorService {
  private readonly logger = new Logger(OutlierDetectorService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Detect outliers in cycle recommendations using statistical analysis.
   * Flags: >2σ from cohort mean, large YoY changes, compression/inversion risks.
   */
  async detect(
    tenantId: string,
    cycleId: string,
  ): Promise<OutlierResult> {
    const recommendations = await this.db.client.compRecommendation.findMany({
      where: { cycleId },
      include: {
        employee: true,
      },
    });

    if (recommendations.length === 0) {
      return {
        cycleId,
        totalOutliers: 0,
        outliers: [],
        byType: {},
        bySeverity: {} as Record<AlertSeverity, number>,
      };
    }

    const outliers: OutlierRecord[] = [];

    // Group recommendations by department+level cohort
    const cohorts = new Map<string, typeof recommendations>();
    for (const rec of recommendations) {
      const key = `${rec.employee.department}:${rec.employee.level}`;
      const group = cohorts.get(key) ?? [];
      group.push(rec);
      cohorts.set(key, group);
    }

    // Statistical outlier detection per cohort
    for (const [cohortKey, cohortRecs] of cohorts) {
      const changePcts = cohortRecs.map((r) => {
        const base = Number(r.currentValue);
        return base > 0
          ? ((Number(r.proposedValue) - base) / base) * 100
          : 0;
      });

      const { mean, stdDev } = this.computeStats(changePcts);

      for (let i = 0; i < cohortRecs.length; i++) {
        const rec = cohortRecs[i]!;
        const emp = rec.employee;
        const changePct = changePcts[i]!;
        const zScore = stdDev > 0 ? (changePct - mean) / stdDev : 0;

        // Statistical outlier: >2σ from cohort mean
        if (Math.abs(zScore) > Z_SCORE_THRESHOLD && cohortRecs.length >= 3) {
          outliers.push({
            recommendationId: rec.id,
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            department: emp.department,
            level: emp.level,
            outlierType: 'STATISTICAL_OUTLIER',
            value: changePct,
            cohortMean: Math.round(mean * 100) / 100,
            cohortStdDev: Math.round(stdDev * 100) / 100,
            zScore: Math.round(zScore * 100) / 100,
            details: `Change of ${changePct.toFixed(1)}% is ${Math.abs(zScore).toFixed(1)}σ from cohort mean (${mean.toFixed(1)}%) in ${cohortKey}`,
            severity: Math.abs(zScore) > 3 ? 'CRITICAL' : 'HIGH',
          });
        }

        // Large YoY change (>25% increase or any decrease)
        if (changePct > 25 || changePct < -5) {
          outliers.push({
            recommendationId: rec.id,
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            department: emp.department,
            level: emp.level,
            outlierType: 'LARGE_YOY_CHANGE',
            value: changePct,
            cohortMean: Math.round(mean * 100) / 100,
            cohortStdDev: Math.round(stdDev * 100) / 100,
            zScore: Math.round(zScore * 100) / 100,
            details: `Change of ${changePct.toFixed(1)}% is unusually ${changePct > 0 ? 'large' : 'negative'}`,
            severity: changePct < -5 ? 'CRITICAL' : 'HIGH',
          });
        }
      }
    }

    // Compression/inversion detection
    this.detectCompressionInversion(recommendations, outliers);

    const bySeverity = this.countBy(outliers, 'severity') as Record<AlertSeverity, number>;
    const byType = this.countBy(outliers, 'outlierType');

    const result: OutlierResult = {
      cycleId,
      totalOutliers: outliers.length,
      outliers,
      byType,
      bySeverity,
    };

    this.logger.log(
      `Outliers for cycle ${cycleId}: ${outliers.length} found`,
    );

    return result;
  }

  /**
   * Create alerts for outlier detections.
   */
  async createAlerts(
    tenantId: string,
    cycleId: string,
    result: OutlierResult,
  ): Promise<MonitorAlert[]> {
    const alerts: MonitorAlert[] = [];

    if (result.totalOutliers > 0) {
      alerts.push({
        cycleId,
        alertType: 'OUTLIER',
        severity: (result.bySeverity['CRITICAL'] ?? 0) > 0 ? 'CRITICAL' : 'HIGH',
        title: `${result.totalOutliers} outlier(s) detected`,
        details: {
          totalOutliers: result.totalOutliers,
          byType: result.byType,
          bySeverity: result.bySeverity,
          topOutliers: result.outliers.slice(0, 10).map((o) => ({
            employee: o.employeeName,
            type: o.outlierType,
            zScore: o.zScore,
            details: o.details,
          })),
        },
      });
    }

    await this.persistAlerts(tenantId, cycleId, alerts);
    return alerts;
  }

  private detectCompressionInversion(
    recommendations: Array<{
      id: string;
      proposedValue: unknown;
      employee: {
        id: string;
        firstName: string;
        lastName: string;
        department: string;
        level: string;
        managerId: string | null;
        baseSalary: unknown;
      };
    }>,
    outliers: OutlierRecord[],
  ): void {
    // Group by department to check for compression/inversion
    const byDept = new Map<string, typeof recommendations>();
    for (const rec of recommendations) {
      const dept = rec.employee.department;
      const group = byDept.get(dept) ?? [];
      group.push(rec);
      byDept.set(dept, group);
    }

    for (const [, deptRecs] of byDept) {
      // Sort by level to detect compression between levels
      const sorted = [...deptRecs].sort((a, b) =>
        a.employee.level.localeCompare(b.employee.level),
      );

      for (let i = 1; i < sorted.length; i++) {
        const junior = sorted[i - 1]!;
        const senior = sorted[i]!;
        const juniorProposed = Number(junior.proposedValue);
        const seniorProposed = Number(senior.proposedValue);

        // Inversion: junior would earn more than senior
        if (juniorProposed > seniorProposed && seniorProposed > 0) {
          const gap = ((juniorProposed - seniorProposed) / seniorProposed) * 100;
          outliers.push({
            recommendationId: senior.id,
            employeeId: senior.employee.id,
            employeeName: `${senior.employee.firstName} ${senior.employee.lastName}`,
            department: senior.employee.department,
            level: senior.employee.level,
            outlierType: 'INVERSION_RISK' as OutlierType,
            value: gap,
            cohortMean: 0,
            cohortStdDev: 0,
            zScore: 0,
            details: `${junior.employee.level} (${junior.employee.firstName} ${junior.employee.lastName}) would earn ${gap.toFixed(1)}% more than ${senior.employee.level}`,
            severity: 'HIGH' as AlertSeverity,
          });
        }

        // Compression: gap between levels is <5%
        if (seniorProposed > 0 && juniorProposed > 0) {
          const gapPct = ((seniorProposed - juniorProposed) / seniorProposed) * 100;
          if (gapPct >= 0 && gapPct < 5) {
            outliers.push({
              recommendationId: senior.id,
              employeeId: senior.employee.id,
              employeeName: `${senior.employee.firstName} ${senior.employee.lastName}`,
              department: senior.employee.department,
              level: senior.employee.level,
              outlierType: 'COMPRESSION_RISK' as OutlierType,
              value: gapPct,
              cohortMean: 0,
              cohortStdDev: 0,
              zScore: 0,
              details: `Only ${gapPct.toFixed(1)}% gap between ${junior.employee.level} and ${senior.employee.level}`,
              severity: 'MEDIUM' as AlertSeverity,
            });
          }
        }
      }
    }
  }

  private computeStats(values: number[]): { mean: number; stdDev: number } {
    if (values.length === 0) return { mean: 0, stdDev: 0 };
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return { mean, stdDev: Math.sqrt(variance) };
  }

  private countBy<T>(items: T[], key: keyof T): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const val = String(item[key]);
      counts[val] = (counts[val] ?? 0) + 1;
    }
    return counts;
  }

  private async persistAlerts(
    tenantId: string,
    cycleId: string,
    alerts: MonitorAlert[],
  ): Promise<void> {
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

