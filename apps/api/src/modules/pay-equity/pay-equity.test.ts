import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the LLM-invoking functions BEFORE importing the service so the service
// picks up the stubs. The agents themselves live in @compensation/ai; we stub
// only the invokers so unit tests don't make network calls.
vi.mock('@compensation/ai', async () => {
  const actual = await vi.importActual<typeof import('@compensation/ai')>('@compensation/ai');
  return {
    ...actual,
    invokeCohortRootCauseGraph: vi.fn(),
    invokeOutlierExplainerGraph: vi.fn(),
    invokeRemediationGraph: vi.fn(),
    invokeProjectionGraph: vi.fn(),
  };
});

import { PayEquityV2Service } from './pay-equity.service';
import { renderReport } from './report-renderers';
import {
  invokeCohortRootCauseGraph,
  invokeOutlierExplainerGraph,
  invokeProjectionGraph,
  invokeRemediationGraph,
} from '@compensation/ai';
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

// ─── Phase 1.5: AI agents (LLM mocked) ─────────────────────────────────

const mockedCohortAgent = vi.mocked(invokeCohortRootCauseGraph);
const mockedOutlierAgent = vi.mocked(invokeOutlierExplainerGraph);

describe('PayEquityV2Service.analyzeCohortRootCause', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
    mockedCohortAgent.mockReset();
  });

  function parentRunFixture() {
    return {
      id: 'parent-run',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      controls: ['job_level', 'tenure'],
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'F',
            referenceGroup: 'M',
            gapPercent: -3.2,
            pValue: 0.04,
            sampleSize: 100,
            coefficient: -0.032,
            significance: 'significant',
          },
          {
            dimension: 'gender',
            group: 'NB',
            referenceGroup: 'M',
            gapPercent: -1,
            pValue: 0.5,
            sampleSize: 8,
            coefficient: -0.01,
            significance: 'not_significant',
          },
        ],
        500,
      ),
    };
  }

  function stubAgentResponse() {
    mockedCohortAgent.mockResolvedValue({
      output: {
        cohort: { dimension: 'gender', group: 'F' },
        rootCauses: [
          { factor: 'level concentration', contribution: 0.6, explanation: 'over-indexed at IC2' },
          { factor: 'tenure imbalance', contribution: 0.4, explanation: 'newer on average' },
        ],
        driverEmployees: ['emp-1'],
        recommendedNextStep: 'Run a level-controlled analysis on IC2 cohort',
      },
      citations: [{ type: 'regression_coefficient', ref: 'gender.F.vs.M', excerpt: 'β=-0.032' }],
      methodology: {
        name: 'edge-multivariate',
        version: '2026.04',
        controls: ['job_level', 'tenure'],
        dependentVariable: 'log_salary',
        sampleSize: 500,
        confidenceInterval: 0.95,
      },
      confidence: 'high',
      warnings: [],
      runId: '',
      generatedAt: new Date().toISOString(),
    });
  }

  it('persists a child PayEquityRun (PENDING→COMPLETE) with agentType=cohort_root_cause', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(parentRunFixture());
    db.client.employee.findMany.mockResolvedValue([
      {
        id: 'emp-1',
        employeeCode: 'E1',
        firstName: 'A',
        lastName: 'D',
        level: 'IC2',
        department: 'Eng',
        location: 'US',
        hireDate: new Date('2024-01-01'),
        baseSalary: 100000,
        currency: 'USD',
        compaRatio: 0.9,
      },
    ]);
    db.client.payEquityRun.create.mockResolvedValue({ id: 'child-1' });
    db.client.payEquityRun.update.mockResolvedValue({ id: 'child-1' });
    db.client.auditLog.create.mockResolvedValue({});
    stubAgentResponse();

    const result = await service.analyzeCohortRootCause(
      TEST_TENANT_ID,
      'parent-run',
      'gender',
      'F',
      TEST_USER_ID,
    );

    expect(mockedCohortAgent).toHaveBeenCalledTimes(1);
    const agentArgs = mockedCohortAgent.mock.calls[0]![0];
    // Service computed the deterministic context for the agent.
    expect(agentArgs.cohort.dimension).toBe('gender');
    expect(agentArgs.cohort.group).toBe('F');
    expect(agentArgs.distributions.byLevel.length).toBeGreaterThan(0);
    expect(agentArgs.siblingCohorts.map((s) => s.group)).toEqual(['NB']);

    // Child run was created PENDING and updated to COMPLETE.
    const createArgs = db.client.payEquityRun.create.mock.calls[0]![0];
    expect(createArgs.data.agentType).toBe('cohort_root_cause');
    expect(createArgs.data.status).toBe('PENDING');
    const updateArgs = db.client.payEquityRun.update.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe('COMPLETE');

    // Envelope returned with runId stamped onto it.
    expect(result.runId).toBe('child-1');
    expect(result.envelope.runId).toBe('child-1');
    expect(result.envelope.output.rootCauses).toHaveLength(2);

    // AuditLog row written with the right action.
    const auditArgs = db.client.auditLog.create.mock.calls[0]![0];
    expect(auditArgs.data.action).toBe('PAY_EQUITY_COHORT_ROOT_CAUSE');
  });

  it('refuses cohorts with n<5 (k-anonymity gate)', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      ...parentRunFixture(),
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'NB',
            referenceGroup: 'M',
            gapPercent: 0,
            pValue: 1,
            sampleSize: 3,
            coefficient: 0,
            significance: 'not_significant',
          },
        ],
        100,
      ),
    });

    await expect(
      service.analyzeCohortRootCause(TEST_TENANT_ID, 'parent-run', 'gender', 'NB', TEST_USER_ID),
    ).rejects.toThrow(/k=5/);
    expect(mockedCohortAgent).not.toHaveBeenCalled();
  });

  it('marks the child run FAILED when the agent throws', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(parentRunFixture());
    db.client.employee.findMany.mockResolvedValue([]);
    db.client.payEquityRun.create.mockResolvedValue({ id: 'child-2' });
    db.client.payEquityRun.update.mockResolvedValue({ id: 'child-2' });
    mockedCohortAgent.mockRejectedValue(new Error('LLM down'));

    await expect(
      service.analyzeCohortRootCause(TEST_TENANT_ID, 'parent-run', 'gender', 'F', TEST_USER_ID),
    ).rejects.toThrow(/LLM down/);

    const failArgs = db.client.payEquityRun.update.mock.calls[0]![0];
    expect(failArgs.data.status).toBe('FAILED');
    expect(failArgs.data.errorMsg).toMatch(/LLM down/);
  });

  it('throws NotFound when the cohort cell is not in the parent run', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(parentRunFixture());
    await expect(
      service.analyzeCohortRootCause(
        TEST_TENANT_ID,
        'parent-run',
        'gender',
        'NotInRun',
        TEST_USER_ID,
      ),
    ).rejects.toThrow(/not in run/);
  });
});

describe('PayEquityV2Service.explainOutlier', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
    mockedOutlierAgent.mockReset();
  });

  function parentRun() {
    return {
      id: 'parent-run',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      controls: ['job_level'],
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'F',
            referenceGroup: 'M',
            gapPercent: -5,
            pValue: 0.01,
            sampleSize: 100,
            significance: 'significant',
          },
        ],
        500,
      ),
    };
  }

  function stubExplainer(severity: 'low' | 'medium' | 'high' = 'medium') {
    mockedOutlierAgent.mockResolvedValue({
      output: {
        employeeId: 'emp-1',
        paragraph: 'This person sits below their cohort median.',
        recommendedAction: 'Adjust salary by 5%.',
        severity,
      },
      citations: [{ type: 'employee_row', ref: 'emp-1' }],
      methodology: {
        name: 'edge-multivariate',
        version: '2026.04',
        controls: ['job_level'],
        dependentVariable: 'log_salary',
        sampleSize: 500,
        confidenceInterval: 0.95,
      },
      confidence: 'high',
      warnings: [],
      runId: '',
      generatedAt: new Date().toISOString(),
    });
  }

  it('persists an explainer run with agentType=outlier_explainer + audit log', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(parentRun());
    db.client.employee.findFirst.mockResolvedValue({
      id: 'emp-1',
      employeeCode: 'E1',
      firstName: 'A',
      lastName: 'D',
      level: 'IC2',
      department: 'Eng',
      location: 'US',
      hireDate: new Date('2024-01-01'),
      baseSalary: 90000,
      currency: 'USD',
      compaRatio: 0.85,
      performanceRating: 4,
      gender: 'F',
    });
    db.client.employee.findMany.mockResolvedValue([
      { baseSalary: 100000, compaRatio: 0.95 },
      { baseSalary: 105000, compaRatio: 1 },
    ]);
    db.client.payEquityRun.create.mockResolvedValue({ id: 'child-3' });
    db.client.payEquityRun.update.mockResolvedValue({ id: 'child-3' });
    db.client.auditLog.create.mockResolvedValue({});
    stubExplainer('high');

    const result = await service.explainOutlier(
      TEST_TENANT_ID,
      'parent-run',
      'emp-1',
      TEST_USER_ID,
    );

    expect(mockedOutlierAgent).toHaveBeenCalledTimes(1);
    const agentArgs = mockedOutlierAgent.mock.calls[0]![0];
    expect(agentArgs.employee.id).toBe('emp-1');
    expect(agentArgs.cohort.dimension).toBe('gender');
    expect(agentArgs.peerContext.peerCount).toBe(2);
    expect(agentArgs.peerContext.peerMeanSalary).toBe(102500);

    const createArgs = db.client.payEquityRun.create.mock.calls[0]![0];
    expect(createArgs.data.agentType).toBe('outlier_explainer');

    const auditArgs = db.client.auditLog.create.mock.calls[0]![0];
    expect(auditArgs.data.action).toBe('PAY_EQUITY_OUTLIER_EXPLAIN');
    expect(auditArgs.data.changes.severity).toBe('high');

    expect(result.envelope.output.severity).toBe('high');
  });

  it('refuses when the employee is not in any significant cohort in the run', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      ...parentRun(),
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'F',
            gapPercent: -1,
            pValue: 0.5,
            sampleSize: 100,
            significance: 'not_significant',
          },
        ],
        500,
      ),
    });
    db.client.employee.findFirst.mockResolvedValue({
      id: 'emp-1',
      employeeCode: 'E1',
      firstName: 'A',
      lastName: 'D',
      level: 'IC2',
      department: 'Eng',
      location: 'US',
      hireDate: new Date(),
      baseSalary: 90000,
      currency: 'USD',
      compaRatio: 0.85,
      performanceRating: 3,
      gender: 'F',
    });

    await expect(
      service.explainOutlier(TEST_TENANT_ID, 'parent-run', 'emp-1', TEST_USER_ID),
    ).rejects.toThrow(/not in any statistically-significant cohort/);
    expect(mockedOutlierAgent).not.toHaveBeenCalled();
  });

  it('refuses when the employee has no compa-ratio', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(parentRun());
    db.client.employee.findFirst.mockResolvedValue({
      id: 'emp-1',
      employeeCode: 'E1',
      firstName: 'A',
      lastName: 'D',
      level: 'IC2',
      department: 'Eng',
      location: 'US',
      hireDate: new Date(),
      baseSalary: 90000,
      currency: 'USD',
      compaRatio: null,
      performanceRating: 3,
      gender: 'F',
    });

    await expect(
      service.explainOutlier(TEST_TENANT_ID, 'parent-run', 'emp-1', TEST_USER_ID),
    ).rejects.toThrow(/compa-ratio/);
  });
});

// ─── Phase 2: Remediation ──────────────────────────────────────────────

const mockedRemediationAgent = vi.mocked(invokeRemediationGraph);

function stubRemediationAgent(adjustmentCount: number) {
  mockedRemediationAgent.mockImplementation((input) =>
    Promise.resolve({
      output: {
        targetGap: input.plan.targetGapPercent,
        totalCost: input.plan.totalCost,
        affectedEmployees: input.plan.affectedEmployees,
        adjustments: input.adjustments.slice(0, adjustmentCount).map((a) => ({
          employeeId: a.employeeId,
          fromValue: a.currentSalary,
          toValue: a.proposedSalary,
          justification: `Adjust ${a.employeeCode} toward cohort mean for ${a.cohort.dimension}/${a.cohort.group}`,
        })),
        alternativeScenarios: [
          {
            label: 'Aggressive',
            targetGap: 1,
            cost: input.plan.totalCost * 1.5,
            summary: '50% larger',
          },
        ],
      },
      citations: [],
      methodology: {
        name: 'edge-multivariate',
        version: '2026.04',
        controls: ['job_level'],
        dependentVariable: 'log_salary',
        sampleSize: 500,
        confidenceInterval: 0.95,
      },
      confidence: 'high',
      warnings: [],
      runId: '',
      generatedAt: new Date().toISOString(),
    }),
  );
}

describe('PayEquityV2Service.calculateRemediations', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
    mockedRemediationAgent.mockReset();
  });

  function parentRunWithSignificantCohort() {
    return {
      id: 'parent-run',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      controls: ['job_level'],
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'F',
            referenceGroup: 'M',
            gapPercent: -5,
            pValue: 0.01,
            sampleSize: 100,
            coefficient: -0.05,
            significance: 'significant',
          },
        ],
        500,
      ),
    };
  }

  it('proposes adjustments for underpaid employees in significant cohorts and persists rows', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(parentRunWithSignificantCohort());
    db.client.employee.findMany.mockResolvedValue([
      // Underpaid (CR < 1) — should be adjusted
      {
        id: 'emp-1',
        employeeCode: 'E1',
        firstName: 'A',
        lastName: 'D',
        level: 'L4',
        department: 'Eng',
        baseSalary: 90000,
        currency: 'USD',
        compaRatio: 0.85,
      },
      {
        id: 'emp-2',
        employeeCode: 'E2',
        firstName: 'B',
        lastName: 'E',
        level: 'L4',
        department: 'Eng',
        baseSalary: 95000,
        currency: 'USD',
        compaRatio: 0.9,
      },
      // At-or-above CR 1 — should NOT be adjusted
      {
        id: 'emp-3',
        employeeCode: 'E3',
        firstName: 'C',
        lastName: 'F',
        level: 'L4',
        department: 'Eng',
        baseSalary: 110000,
        currency: 'USD',
        compaRatio: 1.05,
      },
    ]);
    db.client.payEquityRun.create.mockResolvedValue({ id: 'rem-run-1' });
    db.client.payEquityRun.update.mockResolvedValue({ id: 'rem-run-1' });
    db.client.payEquityRemediation.createMany.mockResolvedValue({ count: 2 });
    db.client.auditLog.create.mockResolvedValue({});
    stubRemediationAgent(2);

    const result = await service.calculateRemediations(
      TEST_TENANT_ID,
      'parent-run',
      { targetGapPercent: 2, maxPerEmployeePct: 0.15 },
      TEST_USER_ID,
    );

    // Agent received 2 adjustments (only emp-1 + emp-2 — underpaid).
    expect(mockedRemediationAgent).toHaveBeenCalledTimes(1);
    const agentArgs = mockedRemediationAgent.mock.calls[0]![0];
    expect(agentArgs.adjustments).toHaveLength(2);
    expect(agentArgs.adjustments.map((a) => a.employeeId).sort()).toEqual(['emp-1', 'emp-2']);

    // Adjustments are sorted by lowest CR first (emp-1 CR=0.85 before emp-2 CR=0.9).
    expect(agentArgs.adjustments[0]!.employeeId).toBe('emp-1');

    // PayEquityRemediation rows persisted with PROPOSED status.
    const createManyArgs = db.client.payEquityRemediation.createMany.mock.calls[0]![0];
    expect(createManyArgs.data).toHaveLength(2);
    expect(createManyArgs.data[0].status).toBe('PROPOSED');
    expect(createManyArgs.data[0].justification).toMatch(/cohort mean/);

    // AuditLog row written with the right action.
    const auditArgs = db.client.auditLog.create.mock.calls[0]![0];
    expect(auditArgs.data.action).toBe('PAY_EQUITY_REMEDIATION_PROPOSED');
    expect(auditArgs.data.changes.affectedEmployees).toBe(2);
    expect(result.runId).toBe('rem-run-1');
  });

  it('caps single-employee adjustment at maxPerEmployeePct of base salary', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(parentRunWithSignificantCohort());
    db.client.employee.findMany.mockResolvedValue([
      // Cohort mean will be 200000 from this employee alone, gap is huge
      {
        id: 'emp-1',
        employeeCode: 'E1',
        firstName: 'A',
        lastName: 'D',
        level: 'L4',
        department: 'Eng',
        baseSalary: 100000,
        currency: 'USD',
        compaRatio: 0.5,
      },
      {
        id: 'emp-2',
        employeeCode: 'E2',
        firstName: 'B',
        lastName: 'E',
        level: 'L4',
        department: 'Eng',
        baseSalary: 300000,
        currency: 'USD',
        compaRatio: 1.5,
      },
    ]);
    db.client.payEquityRun.create.mockResolvedValue({ id: 'rem-run-2' });
    db.client.payEquityRun.update.mockResolvedValue({ id: 'rem-run-2' });
    db.client.payEquityRemediation.createMany.mockResolvedValue({ count: 1 });
    db.client.auditLog.create.mockResolvedValue({});
    stubRemediationAgent(1);

    await service.calculateRemediations(
      TEST_TENANT_ID,
      'parent-run',
      { targetGapPercent: 2, maxPerEmployeePct: 0.15 },
      TEST_USER_ID,
    );

    const agentArgs = mockedRemediationAgent.mock.calls[0]![0];
    // emp-1 is at 100000; cap at 15% means proposed <= 115000.
    expect(agentArgs.adjustments[0]!.proposedSalary).toBeLessThanOrEqual(115000);
    expect(agentArgs.adjustments[0]!.proposedSalary).toBeGreaterThan(100000);
  });

  it('refuses when no significant cohorts exceed the target gap', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      ...parentRunWithSignificantCohort(),
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'F',
            referenceGroup: 'M',
            gapPercent: -1,
            pValue: 0.5,
            sampleSize: 100,
            coefficient: -0.01,
            significance: 'not_significant',
          },
        ],
        500,
      ),
    });

    await expect(
      service.calculateRemediations(
        TEST_TENANT_ID,
        'parent-run',
        { targetGapPercent: 2 },
        TEST_USER_ID,
      ),
    ).rejects.toThrow(/No statistically-significant cohorts/);
  });

  it('marks the remediation run FAILED when the agent throws', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(parentRunWithSignificantCohort());
    db.client.employee.findMany.mockResolvedValue([
      {
        id: 'emp-1',
        employeeCode: 'E1',
        firstName: 'A',
        lastName: 'D',
        level: 'L4',
        department: 'Eng',
        baseSalary: 90000,
        currency: 'USD',
        compaRatio: 0.85,
      },
    ]);
    db.client.payEquityRun.create.mockResolvedValue({ id: 'rem-run-3' });
    db.client.payEquityRun.update.mockResolvedValue({ id: 'rem-run-3' });
    mockedRemediationAgent.mockRejectedValue(new Error('LLM down'));

    await expect(
      service.calculateRemediations(
        TEST_TENANT_ID,
        'parent-run',
        { targetGapPercent: 2 },
        TEST_USER_ID,
      ),
    ).rejects.toThrow(/LLM down/);

    const failArgs = db.client.payEquityRun.update.mock.calls[0]![0];
    expect(failArgs.data.status).toBe('FAILED');
  });
});

describe('PayEquityV2Service.decideRemediation', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('flips PROPOSED to APPROVED and writes audit log', async () => {
    db.client.payEquityRemediation.findFirst.mockResolvedValue({
      id: 'rem-1',
      tenantId: TEST_TENANT_ID,
      runId: 'rem-run-1',
      employeeId: 'emp-1',
      fromValue: 90000,
      toValue: 95000,
      status: 'PROPOSED',
    });
    db.client.payEquityRemediation.update.mockResolvedValue({ id: 'rem-1' });
    db.client.auditLog.create.mockResolvedValue({});

    await service.decideRemediation(TEST_TENANT_ID, 'rem-1', 'APPROVED', TEST_USER_ID);

    const updateArgs = db.client.payEquityRemediation.update.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe('APPROVED');
    expect(updateArgs.data.decidedByUserId).toBe(TEST_USER_ID);
    expect(updateArgs.data.decidedAt).toBeInstanceOf(Date);

    const auditArgs = db.client.auditLog.create.mock.calls[0]![0];
    expect(auditArgs.data.action).toBe('PAY_EQUITY_REMEDIATION_APPROVED');
  });

  it('refuses to decide a row that is already APPROVED', async () => {
    db.client.payEquityRemediation.findFirst.mockResolvedValue({
      id: 'rem-1',
      tenantId: TEST_TENANT_ID,
      runId: 'rem-run-1',
      employeeId: 'emp-1',
      fromValue: 90000,
      toValue: 95000,
      status: 'APPROVED',
    });

    await expect(
      service.decideRemediation(TEST_TENANT_ID, 'rem-1', 'APPROVED', TEST_USER_ID),
    ).rejects.toThrow(/PROPOSED/);
  });
});

describe('PayEquityV2Service.applyApprovedRemediations', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('writes baseSalary, marks each row APPLIED, emits audit log per change', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'rem-run-1',
      tenantId: TEST_TENANT_ID,
      agentType: 'remediation',
      status: 'COMPLETE',
    });
    db.client.payEquityRemediation.findMany.mockResolvedValue([
      {
        id: 'rem-1',
        tenantId: TEST_TENANT_ID,
        runId: 'rem-run-1',
        employeeId: 'emp-1',
        fromValue: 90000,
        toValue: 95000,
        status: 'APPROVED',
      },
      {
        id: 'rem-2',
        tenantId: TEST_TENANT_ID,
        runId: 'rem-run-1',
        employeeId: 'emp-2',
        fromValue: 80000,
        toValue: 84000,
        status: 'APPROVED',
      },
    ]);
    db.client.employee.update.mockResolvedValue({});
    db.client.payEquityRemediation.update.mockResolvedValue({});
    db.client.auditLog.create.mockResolvedValue({});

    const result = await service.applyApprovedRemediations(
      TEST_TENANT_ID,
      'rem-run-1',
      TEST_USER_ID,
    );

    expect(result.applied).toBe(2);
    expect(result.totalCost).toBe(9000); // 5000 + 4000
    expect(result.employeeIds).toEqual(['emp-1', 'emp-2']);

    expect(db.client.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { baseSalary: 95000 },
    });
    expect(db.client.payEquityRemediation.update).toHaveBeenCalledTimes(2);
    expect(db.client.auditLog.create).toHaveBeenCalledTimes(2);

    const auditArgs = db.client.auditLog.create.mock.calls[0]![0];
    expect(auditArgs.data.action).toBe('PAY_EQUITY_REMEDIATION_APPLIED');
    expect(auditArgs.data.entityType).toBe('Employee');
  });

  it('returns zero counts when no rows are APPROVED', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'rem-run-1',
      tenantId: TEST_TENANT_ID,
      agentType: 'remediation',
      status: 'COMPLETE',
    });
    db.client.payEquityRemediation.findMany.mockResolvedValue([]);

    const result = await service.applyApprovedRemediations(
      TEST_TENANT_ID,
      'rem-run-1',
      TEST_USER_ID,
    );

    expect(result.applied).toBe(0);
    expect(db.client.employee.update).not.toHaveBeenCalled();
  });

  it('refuses if the run is not a remediation run', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'narrative-run',
      tenantId: TEST_TENANT_ID,
      agentType: 'narrative',
      status: 'COMPLETE',
    });

    await expect(
      service.applyApprovedRemediations(TEST_TENANT_ID, 'narrative-run', TEST_USER_ID),
    ).rejects.toThrow(/expected remediation/);
  });
});

// ─── Phase 3 — Reports ──────────────────────────────────────────────────

describe('renderReport', () => {
  function ctx(extra: Partial<Parameters<typeof renderReport>[1]> = {}) {
    const envelope = buildEnvelope(
      [
        {
          dimension: 'gender',
          group: 'Female',
          referenceGroup: 'Male',
          coefficient: -0.032,
          standardError: 0.011,
          tStatistic: -2.91,
          pValue: 0.004,
          confidenceInterval: [-0.054, -0.01] as [number, number],
          sampleSize: 250,
          gapPercent: -3.2,
          significance: 'significant',
          riskLevel: 'MEDIUM',
        },
      ],
      500,
    );
    (envelope.citations as Array<{ type: string; ref: string; excerpt: string }>).push({
      type: 'regression_coefficient',
      ref: 'gender.Female.vs.Male',
      excerpt: 'β=-0.032',
    });
    return {
      runId: 'run-rep',
      runAt: new Date('2026-04-28T10:00:00Z'),
      tenantId: TEST_TENANT_ID,
      tenantName: 'Acme Corp',
      envelope: envelope as unknown as Parameters<typeof renderReport>[1]['envelope'],
      ...extra,
    };
  }

  it('board: returns pdf-html with executive summary, cohort table, and methodology box', () => {
    const out = renderReport('board', ctx());
    expect(out.format).toBe('pdf-html');
    expect(out.filename).toMatch(/^pay-equity-board-.*\.pdf$/);
    if (out.format !== 'pdf-html') throw new Error('expected pdf-html');
    expect(out.html).toMatch(/Pay Equity Report/);
    expect(out.html).toMatch(/Executive summary/);
    expect(out.html).toMatch(/Cohort findings/);
    expect(out.html).toMatch(/edge-multivariate/);
    expect(out.html).toMatch(/Female/);
  });

  it('eu_ptd: csv has Article 9 header + cohort rows with statutory columns', () => {
    const out = renderReport('eu_ptd', ctx());
    expect(out.format).toBe('csv');
    if (out.format !== 'csv') throw new Error('expected csv');
    expect(out.content).toMatch(/EU Pay Transparency Directive/);
    expect(out.content).toMatch(/Directive \(EU\) 2023\/970/);
    expect(out.content).toMatch(/category_of_workers/);
    expect(out.content).toMatch(/median_pay_gap_percent/);
    // bonus + median fields are flagged not_available rather than empty
    expect(out.content).toMatch(/not_available/);
    expect(out.content).toMatch(/Female/);
  });

  it('uk_gpg: csv emits the six required figures with median+bonus marked not_available', () => {
    const out = renderReport('uk_gpg', ctx());
    if (out.format !== 'csv') throw new Error('expected csv');
    expect(out.content).toMatch(/UK Gender Pay Gap/);
    expect(out.content).toMatch(/mean_gender_pay_gap_percent/);
    expect(out.content).toMatch(/median_gender_pay_gap_percent/);
    expect(out.content).toMatch(/mean_bonus_pay_gap_percent/);
    expect(out.content).toMatch(/quartile_lower_male_percent/);
    expect(out.content).toMatch(/quartile_upper_female_percent/);
    expect(out.content).toMatch(/-3.2/); // mean computed from regression coefficient
  });

  it('eeo1: csv emits EEO header + sex column populated for gender cohorts', () => {
    const out = renderReport('eeo1', ctx());
    if (out.format !== 'csv') throw new Error('expected csv');
    expect(out.content).toMatch(/EEO-1 Component 1/);
    expect(out.content).toMatch(/eeo_job_category/);
    expect(out.content).toMatch(/race_ethnicity/);
    // gender cohort fills the sex column with the group name
    expect(out.content).toMatch(/Female/);
  });

  it('sb1162: csv has SB 1162 header + establishment columns', () => {
    const out = renderReport('sb1162', ctx());
    if (out.format !== 'csv') throw new Error('expected csv');
    expect(out.content).toMatch(/SB 1162/);
    expect(out.content).toMatch(/establishment_id/);
    expect(out.content).toMatch(/median_hourly_rate/);
  });

  it('auditor: pdf-html uses hashed tenant id and watermarks the page', () => {
    const out = renderReport('auditor', ctx());
    if (out.format !== 'pdf-html') throw new Error('expected pdf-html');
    expect(out.html).toMatch(/Auditor Defensibility/);
    expect(out.html).toMatch(/AUDITOR EXPORT/); // watermark text
    // raw tenant id must NOT appear; only its hash
    expect(out.html).not.toContain(TEST_TENANT_ID);
    expect(out.html).toMatch(/Methodology/);
    expect(out.html).toMatch(/Citations/);
  });
});

describe('PayEquityV2Service.generateReport', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  function completeNarrativeRun() {
    return {
      id: 'rep-run-1',
      tenantId: TEST_TENANT_ID,
      agentType: 'narrative',
      status: 'COMPLETE',
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      createdAt: new Date('2026-04-28T10:00:00Z'),
      result: buildEnvelope(
        [
          {
            dimension: 'gender',
            group: 'Female',
            referenceGroup: 'Male',
            coefficient: -0.032,
            standardError: 0.011,
            tStatistic: -2.91,
            pValue: 0.004,
            confidenceInterval: [-0.054, -0.01] as [number, number],
            sampleSize: 250,
            gapPercent: -3.2,
            significance: 'significant',
            riskLevel: 'MEDIUM',
          },
        ],
        500,
      ),
    };
  }

  it('CSV: returns BOM-prefixed UTF-8 buffer + writes audit log', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(completeNarrativeRun());
    db.client.tenant.findUnique.mockResolvedValue({ name: 'Acme Corp' });
    db.client.auditLog.create.mockResolvedValue({});

    const result = await service.generateReport(
      TEST_TENANT_ID,
      'rep-run-1',
      'eu_ptd',
      TEST_USER_ID,
    );

    expect(result.mimeType).toBe('text/csv');
    expect(result.filename).toMatch(/eu-ptd.*\.csv$/);
    // BOM (0xEF 0xBB 0xBF) for Excel UTF-8 compatibility
    expect(result.buffer[0]).toBe(0xef);
    expect(result.buffer[1]).toBe(0xbb);
    expect(result.buffer[2]).toBe(0xbf);
    // Buffer contents include the statutory header
    expect(result.buffer.toString('utf-8')).toMatch(/EU Pay Transparency Directive/);

    // Audit row written with PAY_EQUITY_REPORT_EXPORTED + reportType in changes
    const auditCall = db.client.auditLog.create.mock.calls[0]![0];
    expect(auditCall.data.action).toBe('PAY_EQUITY_REPORT_EXPORTED');
    expect(auditCall.data.entityType).toBe('PayEquityRun');
    expect(auditCall.data.entityId).toBe('rep-run-1');
    expect(auditCall.data.changes.reportType).toBe('eu_ptd');
    expect(auditCall.data.changes.byteLength).toBe(result.buffer.length);
  });

  it('PDF: throws BadRequestException when no Chrome path is cached', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(completeNarrativeRun());
    db.client.tenant.findUnique.mockResolvedValue({ name: 'Acme Corp' });

    // chromePathCache stays null because onModuleInit wasn't called in tests
    await expect(
      service.generateReport(TEST_TENANT_ID, 'rep-run-1', 'board', TEST_USER_ID),
    ).rejects.toThrow(/PDF rendering unavailable/);

    // No audit log on the failure path
    expect(db.client.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects unknown report types', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue(completeNarrativeRun());
    db.client.tenant.findUnique.mockResolvedValue({ name: 'Acme Corp' });
    await expect(
      service.generateReport(
        TEST_TENANT_ID,
        'rep-run-1',
        'gibberish' as unknown as Parameters<typeof service.generateReport>[2],
        TEST_USER_ID,
      ),
    ).rejects.toThrow(/Unknown report type/);
  });

  it('rejects FAILED runs', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      ...completeNarrativeRun(),
      status: 'FAILED',
    });
    await expect(
      service.generateReport(TEST_TENANT_ID, 'rep-run-1', 'eu_ptd', TEST_USER_ID),
    ).rejects.toThrow(/cannot export/);
  });

  it('rejects non-narrative runs (cohort_root_cause / outlier_explainer / remediation)', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      ...completeNarrativeRun(),
      agentType: 'remediation',
    });
    await expect(
      service.generateReport(TEST_TENANT_ID, 'rep-run-1', 'board', TEST_USER_ID),
    ).rejects.toThrow(/only narrative runs are exportable/);
  });
});

// ─── Phase 4 — Predict ───────────────────────────────────────────────

const mockedProjectionAgent = vi.mocked(invokeProjectionGraph);

function stubProjectionAgent() {
  mockedProjectionAgent.mockImplementation((input) =>
    Promise.resolve({
      output: {
        horizonMonths: input.scenario.horizonMonths,
        baselineGap: input.baselineGap,
        projectedGap: input.projectedGap,
        confidenceLow: input.confidenceLow,
        confidenceHigh: input.confidenceHigh,
        monthlySeries: input.projectedSeries,
        drivers: [
          {
            factor: 'hiring_concentration',
            expectedDelta: 1.2,
            explanation: 'Reference-group hires concentrate at L4',
          },
        ],
        recommendedActions: [
          {
            action: 'Diversify L4 hiring slate',
            priority: 'high' as const,
            rationale: 'Concentrating reference-group hires widens the gap',
          },
        ],
        narrative: 'Projected gap widens because of hiring plan',
        riskLevel: 'medium' as const,
        scenarioLabel: input.scenarioLabel,
      },
      citations: [],
      methodology: {
        name: input.methodology.name,
        version: input.methodology.version,
        controls: input.methodology.controls,
        dependentVariable: 'log_salary' as const,
        sampleSize: input.methodology.sampleSize,
        confidenceInterval: 0.95,
      },
      confidence: 'high' as const,
      warnings: [],
      runId: '',
      generatedAt: new Date().toISOString(),
    }),
  );
}

describe('PayEquityV2Service.forecastProjection', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
    mockedProjectionAgent.mockReset();
  });

  function priorRunsRows() {
    // Two runs, ~30 days apart, gap moving 4 → 5
    return [
      {
        id: 'parent-run-2',
        createdAt: new Date('2026-04-15T00:00:00Z'),
        sampleSize: 500,
        methodologyVersion: '2026.04',
        result: buildEnvelope(
          [
            {
              dimension: 'gender',
              group: 'F',
              referenceGroup: 'M',
              gapPercent: -5,
              pValue: 0.01,
              sampleSize: 200,
              significance: 'significant',
            },
          ],
          500,
        ),
      },
      {
        id: 'parent-run-1',
        createdAt: new Date('2026-03-15T00:00:00Z'),
        sampleSize: 500,
        methodologyVersion: '2026.04',
        result: buildEnvelope(
          [
            {
              dimension: 'gender',
              group: 'F',
              referenceGroup: 'M',
              gapPercent: -4,
              pValue: 0.01,
              sampleSize: 200,
              significance: 'significant',
            },
          ],
          500,
        ),
      },
    ];
  }

  it('extrapolates baseline + invokes projection agent + persists child run + audit log', async () => {
    db.client.payEquityRun.findMany.mockResolvedValue(priorRunsRows());
    db.client.payEquityRun.create.mockResolvedValue({ id: 'proj-run-1' });
    db.client.payEquityRun.update.mockResolvedValue({ id: 'proj-run-1' });
    db.client.auditLog.create.mockResolvedValue({});
    stubProjectionAgent();

    const result = await service.forecastProjection(TEST_TENANT_ID, TEST_USER_ID, {
      horizonMonths: 12,
      hiringPlan: [
        { level: 'L4', dimension: 'gender', group: 'Male', count: 50, meanSalary: 120000 },
      ],
    });

    // Agent called once with deterministic projected series
    expect(mockedProjectionAgent).toHaveBeenCalledTimes(1);
    const agentArgs = mockedProjectionAgent.mock.calls[0]![0];
    expect(agentArgs.scenario.horizonMonths).toBe(12);
    expect(agentArgs.scenario.hiringPlan).toHaveLength(1);
    expect(agentArgs.recentRuns.length).toBeGreaterThanOrEqual(1);
    // Series has the four checkpoints (1, 3, 6, 12)
    expect(agentArgs.projectedSeries.map((p) => p.monthsFromNow)).toEqual([1, 3, 6, 12]);
    // Hiring 50 reference-group employees should widen the projected gap vs baseline
    expect(agentArgs.projectedGap).toBeGreaterThan(agentArgs.baselineGap);

    // Child PayEquityRun created with agentType=projection
    const createCall = db.client.payEquityRun.create.mock.calls[0]![0];
    expect(createCall.data.agentType).toBe('projection');
    expect(createCall.data.status).toBe('PENDING');

    // Run completed + audit log written
    const updateCall = db.client.payEquityRun.update.mock.calls[0]![0];
    expect(updateCall.data.status).toBe('COMPLETE');
    const auditCall = db.client.auditLog.create.mock.calls[0]![0];
    expect(auditCall.data.action).toBe('PAY_EQUITY_PROJECTION');
    expect(auditCall.data.changes.horizonMonths).toBe(12);
    expect(result.runId).toBe('proj-run-1');
  });

  it('scenario sign: minority hires close the gap relative to the same plan with reference-group hires', async () => {
    db.client.payEquityRun.findMany.mockResolvedValue(priorRunsRows());
    db.client.payEquityRun.create.mockResolvedValue({ id: 'proj-run-2' });
    db.client.payEquityRun.update.mockResolvedValue({ id: 'proj-run-2' });
    db.client.auditLog.create.mockResolvedValue({});
    stubProjectionAgent();

    // Run 1: hire reference (Male) group
    await service.forecastProjection(TEST_TENANT_ID, TEST_USER_ID, {
      horizonMonths: 12,
      hiringPlan: [
        { level: 'L4', dimension: 'gender', group: 'Male', count: 50, meanSalary: 120000 },
      ],
    });
    const refArgs = mockedProjectionAgent.mock.calls[0]![0];

    // Run 2: hire minority (Female) group with the same baseline runs
    await service.forecastProjection(TEST_TENANT_ID, TEST_USER_ID, {
      horizonMonths: 12,
      hiringPlan: [
        { level: 'L4', dimension: 'gender', group: 'Female', count: 50, meanSalary: 120000 },
      ],
    });
    const minorityArgs = mockedProjectionAgent.mock.calls[1]![0];

    // Same historical extrapolation but minority scenario should have a
    // strictly smaller projected gap than the reference-group scenario.
    expect(minorityArgs.projectedGap).toBeLessThan(refArgs.projectedGap);
  });

  it('refuses when there are no completed narrative runs', async () => {
    db.client.payEquityRun.findMany.mockResolvedValue([]);
    await expect(
      service.forecastProjection(TEST_TENANT_ID, TEST_USER_ID, { horizonMonths: 12 }),
    ).rejects.toThrow(/No completed narrative runs/);
    expect(mockedProjectionAgent).not.toHaveBeenCalled();
  });

  it('marks the child run FAILED when the projection agent throws', async () => {
    db.client.payEquityRun.findMany.mockResolvedValue(priorRunsRows());
    db.client.payEquityRun.create.mockResolvedValue({ id: 'proj-run-3' });
    db.client.payEquityRun.update.mockResolvedValue({ id: 'proj-run-3' });
    mockedProjectionAgent.mockRejectedValue(new Error('LLM down'));

    await expect(
      service.forecastProjection(TEST_TENANT_ID, TEST_USER_ID, { horizonMonths: 12 }),
    ).rejects.toThrow(/LLM down/);

    // Status flipped to FAILED with the error message
    const updateCalls = db.client.payEquityRun.update.mock.calls;
    const lastUpdate = updateCalls[updateCalls.length - 1]![0];
    expect(lastUpdate.data.status).toBe('FAILED');
    expect(lastUpdate.data.errorMsg).toMatch(/LLM down/);
  });
});

describe('PayEquityV2Service.getAirAnalysis', () => {
  let service: PayEquityV2Service;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('computes AIR per cohort and flags those failing the 80% rule', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'air-run-1',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      createdAt: new Date('2026-04-28'),
      result: buildEnvelope(
        [
          {
            // Strong negative coefficient → AIR < 0.8 → fails the rule
            dimension: 'gender',
            group: 'F',
            referenceGroup: 'M',
            coefficient: -0.3,
            sampleSize: 200,
            gapPercent: -25.9,
            significance: 'significant',
          },
          {
            // Small coefficient → AIR ≈ 1 → passes
            dimension: 'department',
            group: 'Sales',
            referenceGroup: 'Eng',
            coefficient: -0.05,
            sampleSize: 150,
            gapPercent: -4.9,
            significance: 'not_significant',
          },
        ],
        500,
      ),
    });

    const result = await service.getAirAnalysis(TEST_TENANT_ID, 'air-run-1');
    expect(result.threshold).toBe(0.8);
    expect(result.cohorts).toHaveLength(2);

    const gender = result.cohorts.find((c) => c.dimension === 'gender')!;
    expect(gender.adverseImpactRatio).toBeLessThan(0.8);
    expect(gender.passesEightyPercentRule).toBe(false);
    expect(gender.severity).toBe('high'); // significant + failing → high

    const dept = result.cohorts.find((c) => c.dimension === 'department')!;
    expect(dept.adverseImpactRatio).toBeGreaterThan(0.8);
    expect(dept.passesEightyPercentRule).toBe(true);
    expect(dept.severity).toBe('low');

    expect(result.summary).toEqual({ total: 2, passing: 1, failing: 1 });
  });

  it('refuses non-COMPLETE runs', async () => {
    db.client.payEquityRun.findFirst.mockResolvedValue({
      id: 'air-run-2',
      tenantId: TEST_TENANT_ID,
      status: 'FAILED',
      methodologyName: 'edge-multivariate',
      methodologyVersion: '2026.04',
      createdAt: new Date(),
      result: buildEnvelope([], 0),
    });
    await expect(service.getAirAnalysis(TEST_TENANT_ID, 'air-run-2')).rejects.toThrow(
      /AIR unavailable/,
    );
  });
});
