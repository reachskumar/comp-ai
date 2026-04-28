import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayEquityV2Service } from './pay-equity.service';
import type { PayEquityService as LegacyAnalyzer } from '../analytics/pay-equity.service';
import { createMockDatabaseService, TEST_TENANT_ID, TEST_USER_ID } from '../../test/setup';

interface MockLegacy {
  analyze: ReturnType<typeof vi.fn>;
}

function createService(legacyAnalyze?: MockLegacy['analyze']) {
  const db = createMockDatabaseService();
  const legacy: MockLegacy = {
    analyze:
      legacyAnalyze ??
      vi.fn().mockResolvedValue({
        id: 'peq-legacy-1',
        tenantId: TEST_TENANT_ID,
        createdAt: new Date().toISOString(),
        dimensions: ['gender'],
        controlVariables: ['job_level', 'tenure', 'performance', 'location', 'department'],
        overallStats: {
          totalEmployees: 500,
          rSquared: 0.81,
          adjustedRSquared: 0.8,
          fStatistic: 142.3,
        },
        regressionResults: [
          {
            dimension: 'gender',
            group: 'Female',
            referenceGroup: 'Male',
            coefficient: -0.032,
            standardError: 0.011,
            tStatistic: -2.91,
            pValue: 0.004,
            confidenceInterval: [-0.054, -0.01] as [number, number],
            sampleSize: 500,
            gapPercent: -3.2,
            significance: 'significant' as const,
            riskLevel: 'MEDIUM' as const,
          },
        ],
        compaRatios: [],
        remediation: {
          totalCost: 487000,
          affectedEmployees: 47,
          avgAdjustment: 10362,
          adjustmentsByGroup: [],
        },
        status: 'complete' as const,
      }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (PayEquityV2Service as any)(db, legacy as unknown as LegacyAnalyzer);
  return { service: service as PayEquityV2Service, db, legacy };
}

describe('PayEquityV2Service.runAnalysis', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
    db.client.payEquityRun.create.mockResolvedValue({ id: 'run-1' });
    db.client.payEquityRun.update.mockResolvedValue({ id: 'run-1' });
    db.client.auditLog.create.mockResolvedValue({});
  });

  it('persists a PayEquityRun row in PENDING then COMPLETE', async () => {
    await service.runAnalysis(TEST_TENANT_ID, TEST_USER_ID, { dimensions: ['gender'] });

    expect(db.client.payEquityRun.create).toHaveBeenCalledTimes(1);
    const createArgs = db.client.payEquityRun.create.mock.calls[0]![0];
    expect(createArgs.data.tenantId).toBe(TEST_TENANT_ID);
    expect(createArgs.data.status).toBe('PENDING');
    expect(createArgs.data.methodologyName).toBe('edge-multivariate');
    expect(createArgs.data.methodologyVersion).toBe('2026.04');

    expect(db.client.payEquityRun.update).toHaveBeenCalledTimes(1);
    const updateArgs = db.client.payEquityRun.update.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe('COMPLETE');
    expect(updateArgs.data.sampleSize).toBe(500);
    expect(updateArgs.data.summary).toMatch(/significant gap/);
  });

  it('emits the PayEquityAgentResult envelope with citations + methodology', async () => {
    const result = await service.runAnalysis(TEST_TENANT_ID, TEST_USER_ID, {
      dimensions: ['gender'],
    });

    expect(result.runId).toBe('run-1');
    expect(result.envelope.methodology.name).toBe('edge-multivariate');
    expect(result.envelope.methodology.version).toBe('2026.04');
    expect(result.envelope.methodology.dependentVariable).toBe('log_salary');
    expect(result.envelope.methodology.confidenceInterval).toBe(0.95);
    expect(result.envelope.citations.length).toBeGreaterThan(0);
    // Every regression result should produce a citation
    expect(result.envelope.citations[0]?.type).toBe('regression_coefficient');
    expect(result.envelope.confidence).toMatch(/^(high|medium|low)$/);
  });

  it('writes an AuditLog row with action=PAY_EQUITY_RUN', async () => {
    await service.runAnalysis(TEST_TENANT_ID, TEST_USER_ID, { dimensions: ['gender'] });

    expect(db.client.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArgs = db.client.auditLog.create.mock.calls[0]![0];
    expect(auditArgs.data.action).toBe('PAY_EQUITY_RUN');
    expect(auditArgs.data.entityType).toBe('PayEquityRun');
    expect(auditArgs.data.entityId).toBe('run-1');
    expect(auditArgs.data.changes.methodologyVersion).toBe('2026.04');
  });

  it('triggers k-anonymity warnings when a cohort has n < 5', async () => {
    const { service: s, db: d } = createService(
      vi.fn().mockResolvedValue({
        id: 'peq-2',
        tenantId: TEST_TENANT_ID,
        createdAt: new Date().toISOString(),
        dimensions: ['gender'],
        controlVariables: [],
        overallStats: {
          totalEmployees: 4,
          rSquared: 0,
          adjustedRSquared: 0,
          fStatistic: 0,
        },
        regressionResults: [
          {
            dimension: 'gender',
            group: 'Female',
            referenceGroup: 'Male',
            coefficient: 0,
            standardError: 0,
            tStatistic: 0,
            pValue: 1,
            confidenceInterval: [0, 0] as [number, number],
            sampleSize: 4,
            gapPercent: 0,
            significance: 'not_significant' as const,
            riskLevel: 'LOW' as const,
          },
        ],
        compaRatios: [],
        remediation: {
          totalCost: 0,
          affectedEmployees: 0,
          avgAdjustment: 0,
          adjustmentsByGroup: [],
        },
        status: 'complete' as const,
      }),
    );
    d.client.payEquityRun.create.mockResolvedValue({ id: 'run-2' });
    d.client.payEquityRun.update.mockResolvedValue({ id: 'run-2' });
    d.client.auditLog.create.mockResolvedValue({});

    const result = await s.runAnalysis(TEST_TENANT_ID, TEST_USER_ID, { dimensions: ['gender'] });

    expect(result.envelope.warnings.some((w) => w.code === 'k_anonymity_violation')).toBe(true);
  });

  it('marks the run FAILED when the analyzer throws', async () => {
    const { service: s, db: d } = createService(vi.fn().mockRejectedValue(new Error('boom')));
    d.client.payEquityRun.create.mockResolvedValue({ id: 'run-3' });
    d.client.payEquityRun.update.mockResolvedValue({ id: 'run-3' });

    await expect(
      s.runAnalysis(TEST_TENANT_ID, TEST_USER_ID, { dimensions: ['gender'] }),
    ).rejects.toThrow(/boom/);

    const failUpdate = d.client.payEquityRun.update.mock.calls[0]![0];
    expect(failUpdate.data.status).toBe('FAILED');
    expect(failUpdate.data.errorMsg).toMatch(/boom/);
  });
});

describe('PayEquityV2Service.getOverview', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('returns hasData=false when no runs exist', async () => {
    db.client.payEquityRun.findMany.mockResolvedValue([]);
    const result = await service.getOverview(TEST_TENANT_ID);
    expect(result.hasData).toBe(false);
  });

  it('extracts headline numbers from the latest run + delta vs previous', async () => {
    const mkRun = (id: string, worstGapPercent: number, sigCount: number) => ({
      id,
      createdAt: new Date(),
      sampleSize: 500,
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      summary: 'summary',
      result: {
        output: {
          regressionResults: Array.from({ length: sigCount }, (_, i) => ({
            dimension: 'gender',
            group: `g${i}`,
            gapPercent: worstGapPercent,
            pValue: 0.01,
            significance: 'significant',
            sampleSize: 100,
          })),
          overallStats: { totalEmployees: 500 },
        },
        confidence: 'high',
        warnings: [],
        citations: [],
        methodology: {},
        runId: id,
        generatedAt: new Date().toISOString(),
      },
    });
    db.client.payEquityRun.findMany.mockResolvedValue([
      mkRun('run-now', -5, 3),
      mkRun('run-prev', -7, 5),
    ]);

    const result = await service.getOverview(TEST_TENANT_ID);

    expect(result.hasData).toBe(true);
    if (result.hasData) {
      expect(result.latestRunId).toBe('run-now');
      expect(result.significantCount).toBe(3);
      expect(result.delta?.worstGapPercentDelta).toBe(2); // -5 - (-7) = 2 (improving)
      expect(result.delta?.significantCountDelta).toBe(-2);
    }
  });
});

// ─── Phase 1 — Diagnose ────────────────────────────────────────────────

function buildEnvelope(
  regressionResults: Array<Record<string, unknown>>,
  totalEmployees: number,
  warnings: Array<{ code: string; message: string }> = [],
) {
  return {
    output: {
      regressionResults,
      compaRatios: [],
      overallStats: { totalEmployees },
    },
    citations: [],
    methodology: {
      name: 'edge-multivariate',
      version: '2026.04',
      controls: [],
      dependentVariable: 'log_salary',
      sampleSize: totalEmployees,
      confidenceInterval: 0.95,
    },
    confidence: 'high',
    warnings,
    runId: 'r',
    generatedAt: new Date().toISOString(),
  };
}

describe('PayEquityV2Service.getTrend', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('returns oldest→newest series with worst-gap per run', async () => {
    db.client.payEquityRun.findMany.mockResolvedValue([
      // Newest first from DB
      {
        id: 'r3',
        createdAt: new Date('2026-04-01'),
        methodologyName: 'edge-multivariate',
        methodologyVersion: '2026.04',
        result: buildEnvelope(
          [
            {
              dimension: 'gender',
              group: 'F',
              gapPercent: -3,
              pValue: 0.04,
              significance: 'significant',
              sampleSize: 100,
            },
          ],
          500,
        ),
      },
      {
        id: 'r2',
        createdAt: new Date('2026-03-01'),
        methodologyName: 'edge-multivariate',
        methodologyVersion: '2026.04',
        result: buildEnvelope(
          [
            {
              dimension: 'gender',
              group: 'F',
              gapPercent: -5,
              pValue: 0.02,
              significance: 'significant',
              sampleSize: 100,
            },
          ],
          480,
        ),
      },
      {
        id: 'r1',
        createdAt: new Date('2026-02-01'),
        methodologyName: 'edge-multivariate',
        methodologyVersion: '2026.03',
        result: buildEnvelope(
          [
            {
              dimension: 'gender',
              group: 'F',
              gapPercent: -7,
              pValue: 0.001,
              significance: 'significant',
              sampleSize: 100,
            },
          ],
          450,
        ),
      },
    ]);

    const result = await service.getTrend(TEST_TENANT_ID, { limit: 10 });

    expect(result.series).toHaveLength(3);
    expect(result.series[0]!.runId).toBe('r1');
    expect(result.series[2]!.runId).toBe('r3');
    expect(result.series[0]!.worstGapPercent).toBe(-7);
    expect(result.series[2]!.worstGapPercent).toBe(-3);
    // Detected the methodology shift between r1 (2026.03) and r2 (2026.04)
    expect(result.methodologyShifts).toContain(1);
  });

  it('filters by dimension when provided', async () => {
    db.client.payEquityRun.findMany.mockResolvedValue([
      {
        id: 'r',
        createdAt: new Date(),
        methodologyName: 'edge-multivariate',
        methodologyVersion: '2026.04',
        result: buildEnvelope(
          [
            {
              dimension: 'gender',
              group: 'F',
              gapPercent: -3,
              pValue: 0.04,
              significance: 'significant',
              sampleSize: 100,
            },
            {
              dimension: 'ethnicity',
              group: 'Black',
              gapPercent: -8,
              pValue: 0.001,
              significance: 'significant',
              sampleSize: 50,
            },
          ],
          500,
        ),
      },
    ]);

    const result = await service.getTrend(TEST_TENANT_ID, { dimension: 'gender' });
    expect(result.series[0]!.worstGapPercent).toBe(-3);
    expect(result.dimension).toBe('gender');
  });
});

describe('PayEquityV2Service.getCohorts', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('returns one cell per regression result with severity score and suppression flags', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'run-1',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
      createdAt: new Date(),
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'F',
            referenceGroup: 'M',
            gapPercent: -3,
            pValue: 0.04,
            significance: 'significant',
            sampleSize: 100,
            riskLevel: 'MEDIUM',
            coefficient: -0.03,
            standardError: 0.01,
            confidenceInterval: [-0.05, -0.01],
          },
          {
            // Below k-anonymity → suppressed
            dimension: 'gender',
            group: 'NB',
            referenceGroup: 'M',
            gapPercent: -2,
            pValue: 0.5,
            significance: 'not_significant',
            sampleSize: 3,
            riskLevel: 'LOW',
            coefficient: -0.02,
            standardError: 0.05,
            confidenceInterval: [-0.1, 0.1],
          },
        ],
        103,
      ),
    });

    const result = await service.getCohorts(TEST_TENANT_ID, 'run-1');

    expect(result.cells).toHaveLength(2);
    expect(result.cells[0]!.suppressed).toBe(false);
    expect(result.cells[1]!.suppressed).toBe(true); // n=3 < 5
    expect(result.cells[0]!.severityScore).toBeGreaterThan(0);
    expect(result.dimensions).toContain('gender');
  });

  it('refuses cohorts on a non-COMPLETE run', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'run-1',
      tenantId: TEST_TENANT_ID,
      status: 'PENDING',
      createdAt: new Date(),
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      result: {},
    });
    await expect(service.getCohorts(TEST_TENANT_ID, 'run-1')).rejects.toThrow(/PENDING/);
  });
});

describe('PayEquityV2Service.getCohortDetail', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('suppresses employee rows when cohort n < 5 (k-anonymity)', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'run-1',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
      createdAt: new Date(),
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'NB',
            referenceGroup: 'M',
            gapPercent: 0,
            pValue: 1,
            significance: 'not_significant',
            sampleSize: 3,
            coefficient: 0,
            standardError: 0,
            confidenceInterval: [0, 0],
          },
        ],
        100,
      ),
    });

    const result = await service.getCohortDetail(TEST_TENANT_ID, 'run-1', 'gender', 'NB');

    expect(result.suppressed).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.suppressionReason).toMatch(/k=5/);
    expect(db.client.employee.findMany).not.toHaveBeenCalled();
  });

  it('returns employee rows when cohort meets k-anonymity', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'run-1',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
      createdAt: new Date(),
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'F',
            referenceGroup: 'M',
            gapPercent: -3,
            pValue: 0.04,
            significance: 'significant',
            sampleSize: 100,
            coefficient: -0.03,
            standardError: 0.01,
            confidenceInterval: [-0.05, -0.01],
          },
        ],
        500,
      ),
    });
    db.client.employee.findMany.mockResolvedValue([
      {
        id: 'e1',
        employeeCode: 'E1',
        firstName: 'A',
        lastName: 'D',
        department: 'Eng',
        level: 'L4',
        location: 'US',
        hireDate: new Date(),
        baseSalary: 100000,
        currency: 'USD',
        performanceRating: 4,
        compaRatio: 0.95,
      },
    ]);

    const result = await service.getCohortDetail(TEST_TENANT_ID, 'run-1', 'gender', 'F');

    expect(result.suppressed).toBe(false);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.name).toBe('A D');
    // Confirm the WHERE filtered by gender=F
    const findArgs = db.client.employee.findMany.mock.calls[0]![0];
    expect(findArgs.where.gender).toBe('F');
  });

  it('throws NotFound when cohort cell is not in the run', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'run-1',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
      createdAt: new Date(),
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      result: buildEnvelope([], 100),
    });

    await expect(service.getCohortDetail(TEST_TENANT_ID, 'run-1', 'gender', 'F')).rejects.toThrow(
      /not found/,
    );
  });
});

describe('PayEquityV2Service.getOutliers', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('returns empty when no significant cohorts in the run', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'run-1',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
      createdAt: new Date(),
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'F',
            gapPercent: -1,
            pValue: 0.5,
            significance: 'not_significant',
            sampleSize: 100,
          },
        ],
        500,
      ),
    });

    const result = await service.getOutliers(TEST_TENANT_ID, 'run-1');
    expect(result.outliers).toEqual([]);
    expect(result.reason).toMatch(/significant/);
  });

  it('returns the lowest compa-ratio employees in significant cohorts', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'run-1',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
      createdAt: new Date(),
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'F',
            gapPercent: -5,
            pValue: 0.01,
            significance: 'significant',
            sampleSize: 100,
          },
        ],
        500,
      ),
    });
    db.client.employee.findMany.mockResolvedValue([
      {
        id: 'e1',
        employeeCode: 'E1',
        firstName: 'Alex',
        lastName: 'D',
        department: 'Eng',
        level: 'L4',
        baseSalary: 90000,
        currency: 'USD',
        compaRatio: 0.85,
      },
    ]);

    const result = await service.getOutliers(TEST_TENANT_ID, 'run-1', { limit: 5 });

    expect(result.outliers).toHaveLength(1);
    expect(result.outliers[0]!.name).toBe('Alex D');
    expect(result.outliers[0]!.cohort.dimension).toBe('gender');
    expect(result.outliers[0]!.explanation).toMatch(/0\.85/);
  });
});
