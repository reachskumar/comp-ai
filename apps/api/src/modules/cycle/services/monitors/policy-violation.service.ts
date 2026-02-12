import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../../database';
import { evaluateRules } from '@compensation/shared';
import type { RuleSet, EmployeeData, Rule } from '@compensation/shared';
import type {
  PolicyViolation,
  PolicyViolationResult,
  MonitorAlert,
  AlertSeverity,
  ViolationType,
} from './types';

@Injectable()
export class PolicyViolationService {
  private readonly logger = new Logger(PolicyViolationService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Detect policy violations for all recommendations in a cycle.
   * Checks each recommendation against active RuleSets.
   */
  async detect(
    tenantId: string,
    cycleId: string,
  ): Promise<PolicyViolationResult> {
    // Load active rule sets for the tenant
    const dbRuleSets = await this.db.client.ruleSet.findMany({
      where: { tenantId, status: 'ACTIVE' },
      include: { rules: { where: { enabled: true }, orderBy: { priority: 'asc' } } },
    });

    // Load all recommendations with employee data
    const recommendations = await this.db.client.compRecommendation.findMany({
      where: { cycleId },
      include: {
        employee: true,
      },
    });

    // Load budgets for budget-related violations
    const budgets = await this.db.client.cycleBudget.findMany({
      where: { cycleId },
    });

    const budgetByDept = new Map(
      budgets.map((b) => [b.department, { allocated: Number(b.allocated), spent: Number(b.spent) }]),
    );

    const violations: PolicyViolation[] = [];

    for (const rec of recommendations) {
      const emp = rec.employee;
      const employeeData: EmployeeData = {
        id: emp.id,
        employeeCode: emp.employeeCode,
        department: emp.department,
        level: emp.level,
        location: emp.location ?? undefined,
        baseSalary: Number(emp.baseSalary),
        hireDate: emp.hireDate,
        terminationDate: emp.terminationDate ?? undefined,
        managerId: emp.managerId ?? undefined,
      };

      // Evaluate against each active rule set
      for (const dbRuleSet of dbRuleSets) {
        const ruleSet: RuleSet = {
          id: dbRuleSet.id,
          name: dbRuleSet.name,
          rules: dbRuleSet.rules.map((r) => ({
            id: r.id,
            name: r.name,
            type: r.ruleType as Rule['type'],
            conditions: Array.isArray(r.conditions) ? r.conditions as unknown as Rule['conditions'] : [],
            actions: Array.isArray(r.actions) ? r.actions as unknown as Rule['actions'] : [],
            priority: r.priority,
            enabled: r.enabled,
          })),
        };

        const result = evaluateRules(employeeData, ruleSet);

        // Check for blocked employees with active recommendations
        if (result.blocked) {
          violations.push({
            recommendationId: rec.id,
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            department: emp.department,
            violationType: 'BLOCKED_BY_RULE',
            ruleName: dbRuleSet.name,
            ruleId: dbRuleSet.id,
            details: `Employee blocked by rule set: ${result.warnings.join('; ')}`,
            severity: 'CRITICAL',
          });
        }

        // Check for cap violations
        this.checkCapFloorViolations(rec, emp, result, dbRuleSet, violations);

        // Check flags as potential violations
        for (const flag of result.flags) {
          violations.push({
            recommendationId: rec.id,
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            department: emp.department,
            violationType: 'UNAPPROVED_EXCEPTION',
            ruleName: dbRuleSet.name,
            ruleId: dbRuleSet.id,
            details: flag,
            severity: 'MEDIUM',
          });
        }
      }

      // Check budget violations
      const deptBudget = budgetByDept.get(emp.department);
      if (deptBudget) {
        const recAmount = Number(rec.proposedValue) - Number(rec.currentValue);
        if (deptBudget.spent + recAmount > deptBudget.allocated && deptBudget.allocated > 0) {
          violations.push({
            recommendationId: rec.id,
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            department: emp.department,
            violationType: 'EXCEEDS_BUDGET',
            ruleName: 'Department Budget',
            ruleId: 'budget-check',
            details: `Recommendation would exceed ${emp.department} budget (allocated: ${deptBudget.allocated}, current spent: ${deptBudget.spent})`,
            severity: 'HIGH',
          });
        }
      }
    }

    const bySeverity = this.countBy(violations, 'severity') as Record<AlertSeverity, number>;
    const byType = this.countBy(violations, 'violationType');

    const result: PolicyViolationResult = {
      cycleId,
      totalViolations: violations.length,
      violations,
      bySeverity,
      byType,
    };

    this.logger.log(
      `Policy violations for cycle ${cycleId}: ${violations.length} found`,
    );

    return result;
  }

  /**
   * Create alerts for policy violations.
   */
  async createAlerts(
    tenantId: string,
    cycleId: string,
    result: PolicyViolationResult,
  ): Promise<MonitorAlert[]> {
    const alerts: MonitorAlert[] = [];

    if (result.totalViolations > 0) {
      alerts.push({
        cycleId,
        alertType: 'POLICY_VIOLATION',
        severity: (result.bySeverity['CRITICAL'] ?? 0) > 0 ? 'CRITICAL' : 'HIGH',
        title: `${result.totalViolations} policy violation(s) detected`,
        details: {
          totalViolations: result.totalViolations,
          bySeverity: result.bySeverity,
          byType: result.byType,
          topViolations: result.violations.slice(0, 10).map((v) => ({
            employee: v.employeeName,
            type: v.violationType,
            details: v.details,
          })),
        },
      });
    }

    await this.persistAlerts(tenantId, cycleId, alerts);
    return alerts;
  }

  private checkCapFloorViolations(
    rec: { id: string; proposedValue: unknown; currentValue: unknown },
    emp: { id: string; firstName: string; lastName: string; department: string; baseSalary: unknown },
    result: { decisions: Array<{ ruleType: string; ruleName: string; ruleId: string; actions: Array<{ type: string; calculatedValue: number }> }> },
    dbRuleSet: { id: string; name: string },
    violations: PolicyViolation[],
  ): void {
    const proposedChange = Number(rec.proposedValue) - Number(rec.currentValue);
    const baseSalary = Number(emp.baseSalary);
    const changePct = baseSalary > 0 ? (proposedChange / baseSalary) * 100 : 0;

    for (const decision of result.decisions) {
      for (const action of decision.actions) {
        if (action.type === 'applyCap' && proposedChange > action.calculatedValue) {
          violations.push({
            recommendationId: rec.id,
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            department: emp.department,
            violationType: 'EXCEEDS_CAP' as ViolationType,
            ruleName: decision.ruleName,
            ruleId: decision.ruleId,
            details: `Proposed change (${changePct.toFixed(1)}%) exceeds cap (${action.calculatedValue})`,
            severity: 'HIGH' as AlertSeverity,
          });
        }
        if (action.type === 'applyFloor' && proposedChange < action.calculatedValue) {
          violations.push({
            recommendationId: rec.id,
            employeeId: emp.id,
            employeeName: `${emp.firstName} ${emp.lastName}`,
            department: emp.department,
            violationType: 'BELOW_FLOOR' as ViolationType,
            ruleName: decision.ruleName,
            ruleId: decision.ruleId,
            details: `Proposed change (${changePct.toFixed(1)}%) is below floor (${action.calculatedValue})`,
            severity: 'MEDIUM' as AlertSeverity,
          });
        }
      }
    }
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

