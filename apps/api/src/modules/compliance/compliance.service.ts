import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database';
import {
  buildComplianceScannerGraph,
  streamGraphToSSE,
  type ComplianceDbAdapter,
  type ComplianceFinding,
  type SSEEvent,
} from '@compensation/ai';
import { HumanMessage } from '@langchain/core/messages';
import { Prisma } from '@compensation/database';

@Injectable()
export class ComplianceService implements ComplianceDbAdapter {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(private readonly db: DatabaseService) {}

  // ─── Scan Management ────────────────────────────────────

  async createScan(tenantId: string, userId: string, scanConfig?: Record<string, unknown>) {
    return this.db.client.complianceScan.create({
      data: {
        tenantId,
        userId,
        status: 'PENDING',
        scanConfig: (scanConfig ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async runScan(scanId: string, tenantId: string, userId: string) {
    await this.db.client.complianceScan.update({
      where: { id: scanId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    try {
      const { graph } = await buildComplianceScannerGraph(this, tenantId);

      const result = await graph.invoke({
        tenantId,
        userId,
        messages: [new HumanMessage('Run a full compliance audit scan.')],
        metadata: {},
        findings: [],
        overallScore: null,
        aiReport: null,
        currentPhase: 'init',
      });

      const findings = (result.findings as ComplianceFinding[]) ?? [];
      const overallScore = (result.overallScore as number) ?? 0;
      const aiReport = (result.aiReport as string) ?? '';

      // Persist findings
      if (findings.length > 0) {
        await this.db.client.complianceFinding.createMany({
          data: findings.map((f) => ({
            scanId,
            category: this.mapCategory(f.category),
            severity: this.mapSeverity(f.severity),
            title: f.title,
            description: f.description,
            explanation: f.explanation ?? '',
            remediation: f.remediation ?? '',
            affectedScope: (f.affectedScope ?? {}) as Prisma.InputJsonValue,
          })),
        });
      }

      // Update scan
      await this.db.client.complianceScan.update({
        where: { id: scanId },
        data: {
          status: 'COMPLETED',
          overallScore,
          aiReport,
          riskSummary: this.buildRiskSummary(findings),
          completedAt: new Date(),
        },
      });

      return { scanId, overallScore, findings, aiReport };
    } catch (error) {
      this.logger.error(`Compliance scan failed: ${scanId}`, error);
      await this.db.client.complianceScan.update({
        where: { id: scanId },
        data: {
          status: 'FAILED',
          errorMsg: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async listScans(tenantId: string, options: { status?: string; page?: number; limit?: number }) {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const where: Prisma.ComplianceScanWhereInput = { tenantId };
    if (options.status) {
      where.status = options.status as Prisma.EnumComplianceScanStatusFilter;
    }

    const [items, total] = await Promise.all([
      this.db.client.complianceScan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { findings: true } } },
      }),
      this.db.client.complianceScan.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getScan(scanId: string, tenantId: string) {
    return this.db.client.complianceScan.findFirst({
      where: { id: scanId, tenantId },
      include: {
        findings: { orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  }

  async getLatestScore(tenantId: string) {
    const scan = await this.db.client.complianceScan.findFirst({
      where: { tenantId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { id: true, overallScore: true, completedAt: true, riskSummary: true },
    });
    return scan ?? { overallScore: null, completedAt: null, riskSummary: {} };
  }

  async getScoreHistory(tenantId: string, limit = 10) {
    return this.db.client.complianceScan.findMany({
      where: { tenantId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: limit,
      select: { id: true, overallScore: true, completedAt: true },
    });
  }

  // ─── ComplianceDbAdapter Implementation ─────────────────

  async getAllRules(tenantId: string): Promise<unknown[]> {
    return this.db.client.ruleSet.findMany({
      where: { tenantId },
      include: { rules: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getRecentDecisions(tenantId: string, limit?: number): Promise<unknown[]> {
    return this.db.client.compRecommendation.findMany({
      where: { cycle: { tenantId } },
      take: limit ?? 100,
      include: {
        employee: {
          select: {
            firstName: true, lastName: true, department: true,
            level: true, baseSalary: true, location: true,
          },
        },
        cycle: { select: { name: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getCompDataStats(tenantId: string): Promise<unknown> {
    const [salaryByDept, salaryByLevel, overall, headcount] = await Promise.all([
      this.db.client.employee.groupBy({
        by: ['department'],
        where: { tenantId },
        _avg: { baseSalary: true, totalComp: true },
        _min: { baseSalary: true },
        _max: { baseSalary: true },
        _count: true,
      }),
      this.db.client.employee.groupBy({
        by: ['level'],
        where: { tenantId },
        _avg: { baseSalary: true, totalComp: true },
        _count: true,
      }),
      this.db.client.employee.aggregate({
        where: { tenantId },
        _avg: { baseSalary: true, totalComp: true },
        _min: { baseSalary: true },
        _max: { baseSalary: true },
        _count: true,
      }),
      this.db.client.employee.count({ where: { tenantId } }),
    ]);

    return { salaryByDept, salaryByLevel, overall, headcount };
  }

  async getBenefitsConfigs(tenantId: string): Promise<unknown[]> {
    return this.db.client.benefitPlan.findMany({
      where: { tenantId },
      include: {
        _count: { select: { enrollments: true } },
      },
    });
  }

  async getRegulatoryRequirements(tenantId: string): Promise<unknown> {
    // Return standard regulatory requirements
    // In production, this would be configurable per tenant
    return {
      flsa: {
        salaryThreshold: 35568,
        overtimeMultiplier: 1.5,
        exemptCategories: ['EXECUTIVE', 'ADMINISTRATIVE', 'PROFESSIONAL', 'COMPUTER', 'OUTSIDE_SALES'],
      },
      payEquity: {
        maxGapPercentage: 10,
        protectedClasses: ['gender', 'ethnicity', 'age'],
      },
      benefits: {
        aca: {
          fullTimeHoursThreshold: 30,
          largeEmployerThreshold: 50,
        },
      },
      dataRetention: {
        payrollRecordsYears: 3,
        benefitsRecordsYears: 6,
      },
    };
  }

  // ─── Private Helpers ────────────────────────────────────

  private mapCategory(category: string): 'FLSA_OVERTIME' | 'PAY_EQUITY' | 'POLICY_VIOLATION' | 'BENEFITS_ELIGIBILITY' | 'REGULATORY_GAP' | 'DATA_QUALITY' {
    const map: Record<string, 'FLSA_OVERTIME' | 'PAY_EQUITY' | 'POLICY_VIOLATION' | 'BENEFITS_ELIGIBILITY' | 'REGULATORY_GAP' | 'DATA_QUALITY'> = {
      FLSA_OVERTIME: 'FLSA_OVERTIME',
      PAY_EQUITY: 'PAY_EQUITY',
      POLICY_VIOLATION: 'POLICY_VIOLATION',
      BENEFITS_ELIGIBILITY: 'BENEFITS_ELIGIBILITY',
      REGULATORY_GAP: 'REGULATORY_GAP',
      DATA_QUALITY: 'DATA_QUALITY',
    };
    return map[category] ?? 'POLICY_VIOLATION';
  }

  private mapSeverity(severity: string): 'CRITICAL' | 'WARNING' | 'INFO' {
    const map: Record<string, 'CRITICAL' | 'WARNING' | 'INFO'> = {
      critical: 'CRITICAL',
      warning: 'WARNING',
      info: 'INFO',
    };
    return map[severity] ?? 'INFO';
  }

  private buildRiskSummary(findings: ComplianceFinding[]) {
    const critical = findings.filter((f) => f.severity === 'critical').length;
    const warning = findings.filter((f) => f.severity === 'warning').length;
    const info = findings.filter((f) => f.severity === 'info').length;

    const byCategory: Record<string, number> = {};
    for (const f of findings) {
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    }

    return {
      total: findings.length,
      critical,
      warning,
      info,
      byCategory,
      riskLevel: critical > 0 ? 'critical' : warning > 2 ? 'high' : warning > 0 ? 'medium' : 'low',
    };
  }
}

