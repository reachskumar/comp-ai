import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub LLM agents (consistent with pay-equity.test.ts pattern).
vi.mock('@compensation/ai', async () => {
  const actual = await vi.importActual<typeof import('@compensation/ai')>('@compensation/ai');
  return {
    ...actual,
    invokeCohortRootCauseGraph: vi.fn(),
    invokeOutlierExplainerGraph: vi.fn(),
    invokeRemediationGraph: vi.fn(),
    invokeProjectionGraph: vi.fn(),
    invokePayEquityCopilotGraph: vi.fn(),
  };
});

import { PEDistributionService } from './pe-distribution.service';
import { PayEquityV2Service } from './pay-equity.service';
import type { LetterEmailService } from '../letters/email.service';
import type { PayEquityService as LegacyAnalyzer } from '../analytics/pay-equity.service';
import { createMockDatabaseService, TEST_TENANT_ID, TEST_USER_ID } from '../../test/setup';

function createDistributionService() {
  const db = createMockDatabaseService();
  const email = {
    send: vi.fn().mockResolvedValue({ messageId: 'msg-1', accepted: ['x'] }),
    isConfigured: vi.fn().mockReturnValue(true),
  };
  const legacy = { analyze: vi.fn() } as unknown as LegacyAnalyzer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pe = new (PayEquityV2Service as any)(db, legacy);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (PEDistributionService as any)(
    db,
    email as unknown as LetterEmailService,
    pe,
  );
  return { service: service as PEDistributionService, db, email, pe };
}

describe('PEDistributionService.createSubscription', () => {
  it('creates a digest subscription, audits it, and computes nextRunAt', async () => {
    const { service, db } = createDistributionService();
    db.client.pEReportSubscription.create.mockResolvedValue({
      id: 'sub-1',
      tenantId: TEST_TENANT_ID,
    });
    db.client.auditLog.create.mockResolvedValue({});

    const result = await service.createSubscription(TEST_TENANT_ID, TEST_USER_ID, {
      reportType: 'digest',
      cadence: 'daily',
      recipients: ['chro@acme.com'],
    });

    expect(result.id).toBe('sub-1');
    const createCall = db.client.pEReportSubscription.create.mock.calls[0]![0];
    expect(createCall.data.reportType).toBe('digest');
    expect(createCall.data.cadence).toBe('daily');
    expect(createCall.data.nextRunAt).toBeInstanceOf(Date);
    const audit = db.client.auditLog.create.mock.calls[0]![0];
    expect(audit.data.action).toBe('PAY_EQUITY_SUBSCRIPTION_CREATED');
  });

  it('rejects unknown report types', async () => {
    const { service } = createDistributionService();
    await expect(
      service.createSubscription(TEST_TENANT_ID, TEST_USER_ID, {
        reportType: 'bogus',
        cadence: 'daily',
        recipients: ['x@y.com'],
      }),
    ).rejects.toThrow(/Unknown reportType/);
  });

  it('rejects when no recipients and no slack webhook', async () => {
    const { service } = createDistributionService();
    await expect(
      service.createSubscription(TEST_TENANT_ID, TEST_USER_ID, {
        reportType: 'digest',
        cadence: 'daily',
        recipients: [],
      }),
    ).rejects.toThrow(/At least one recipient/);
  });
});

describe('PEDistributionService.runDueSubscriptions', () => {
  it('digest subscription: emails recipients + writes audit + reschedules', async () => {
    const { service, db, email, pe } = createDistributionService();
    db.client.pEReportSubscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        tenantId: TEST_TENANT_ID,
        reportType: 'digest',
        cadence: 'daily',
        recipients: ['chro@acme.com'],
        slackWebhook: null,
      },
    ]);
    db.client.pEReportSubscription.update.mockResolvedValue({});
    db.client.auditLog.create.mockResolvedValue({});

    // Stub overview to return populated digest data.
    vi.spyOn(pe, 'getOverview').mockResolvedValue({
      hasData: true as const,
      latestRunId: 'run-1',
      latestRunAt: new Date(),
      methodology: 'edge-multivariate@2026.04',
      worstGapPercent: -3.2,
      worstCohort: 'gender/Female',
      worstPValue: 0.01,
      significantCount: 1,
      atRiskEmployees: 250,
      totalEmployees: 500,
      confidence: 'high' as const,
      warningCount: 0,
      delta: null,
      summary: null,
    });

    const result = await service.runDueSubscriptions();
    expect(result.dispatched).toBe(1);
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send.mock.calls[0]![0].subject).toMatch(/Daily digest/);

    // Audit row written + nextRunAt rescheduled
    const audit = db.client.auditLog.create.mock.calls[0]![0];
    expect(audit.data.action).toBe('PAY_EQUITY_DIGEST_SENT');
    const update = db.client.pEReportSubscription.update.mock.calls[0]![0];
    expect(update.data.nextRunAt).toBeInstanceOf(Date);
    expect(update.data.lastRunAt).toBeInstanceOf(Date);
  });

  it('records lastError when dispatch throws and still reschedules', async () => {
    const { service, db, email } = createDistributionService();
    db.client.pEReportSubscription.findMany.mockResolvedValue([
      {
        id: 'sub-2',
        tenantId: TEST_TENANT_ID,
        reportType: 'board',
        cadence: 'weekly',
        recipients: ['cfo@acme.com'],
        slackWebhook: null,
      },
    ]);
    db.client.payEquityRun.findFirst.mockResolvedValue(null); // no run → throws
    db.client.pEReportSubscription.update.mockResolvedValue({});

    const result = await service.runDueSubscriptions();
    expect(result.failed).toBe(1);
    expect(result.dispatched).toBe(0);
    expect(email.send).not.toHaveBeenCalled();
    const update = db.client.pEReportSubscription.update.mock.calls[0]![0];
    expect(update.data.lastError).toMatch(/No completed narrative runs/);
  });
});

describe('PEDistributionService.createShareToken / resolveShareToken', () => {
  it('creates a token with random string, expiresAt, and audit row', async () => {
    const { service, db, pe } = createDistributionService();
    vi.spyOn(pe, 'getRun').mockResolvedValue({
      id: 'run-1',
      tenantId: TEST_TENANT_ID,
      status: 'COMPLETE',
    } as never);
    db.client.pEShareToken.create.mockResolvedValue({
      id: 'tok-1',
      tenantId: TEST_TENANT_ID,
      runId: 'run-1',
      token: 'abc',
      scope: 'auditor',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    db.client.auditLog.create.mockResolvedValue({});

    const result = await service.createShareToken(TEST_TENANT_ID, TEST_USER_ID, {
      runId: 'run-1',
      scope: 'auditor',
      expiresInDays: 30,
    });

    expect(result.id).toBe('tok-1');
    const audit = db.client.auditLog.create.mock.calls[0]![0];
    expect(audit.data.action).toBe('PAY_EQUITY_SHARE_TOKEN_CREATED');
  });

  it('rejects unknown scope', async () => {
    const { service } = createDistributionService();
    await expect(
      service.createShareToken(TEST_TENANT_ID, TEST_USER_ID, {
        runId: 'run-1',
        scope: 'bogus',
      }),
    ).rejects.toThrow(/Unknown scope/);
  });

  it('resolveShareToken: rejects revoked tokens', async () => {
    const { service, db } = createDistributionService();
    db.client.pEShareToken.findUnique.mockResolvedValue({
      id: 'tok-2',
      tenantId: TEST_TENANT_ID,
      runId: 'run-1',
      token: 'xyz',
      scope: 'auditor',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: new Date(),
    });

    await expect(service.resolveShareToken('xyz')).rejects.toThrow(/revoked/);
  });

  it('resolveShareToken: rejects expired tokens', async () => {
    const { service, db } = createDistributionService();
    db.client.pEShareToken.findUnique.mockResolvedValue({
      id: 'tok-3',
      tenantId: TEST_TENANT_ID,
      runId: 'run-1',
      token: 'old',
      scope: 'auditor',
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
    });

    await expect(service.resolveShareToken('old')).rejects.toThrow(/expired/);
  });
});
