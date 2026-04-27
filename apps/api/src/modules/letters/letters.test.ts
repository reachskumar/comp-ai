import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LettersService } from './letters.service';
import { LetterEmailService } from './email.service';
import { ConfigService } from '@nestjs/config';
import { createMockDatabaseService, TEST_TENANT_ID, TEST_USER_ID } from '../../test/setup';
import { LetterTypeDto } from './dto/generate-letter.dto';

interface MockJob {
  id: string;
  data: unknown;
  progress: number;
  getState: () => Promise<string>;
}

interface MockQueue {
  add: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
}

function createMockQueue(): MockQueue {
  return {
    add: vi.fn(),
    getJob: vi.fn(),
  };
}

interface MockEmail {
  isConfigured: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  buildAckUrl: ReturnType<typeof vi.fn>;
  signAckToken: ReturnType<typeof vi.fn>;
  verifyAckToken: ReturnType<typeof vi.fn>;
}

function createMockEmail(): MockEmail {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    send: vi.fn().mockResolvedValue({ messageId: 'msg-1', accepted: ['x@y.z'] }),
    buildAckUrl: vi.fn().mockReturnValue('https://example.com/ack?token=abc'),
    signAckToken: vi.fn().mockReturnValue('signed-token'),
    verifyAckToken: vi.fn(),
  };
}

function createService() {
  const db = createMockDatabaseService();
  const queue = createMockQueue();
  const email = createMockEmail();
  // Bypass NestJS DI for unit tests; LettersService implements OnModuleInit but
  // we don't trigger init here (no Chrome probe / reaper).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (LettersService as any)(db, queue, email) as LettersService;
  return { service, db, queue, email };
}

describe('LettersService — enqueueBatch', () => {
  let service: LettersService;
  let queue: MockQueue;

  beforeEach(() => {
    ({ service, queue } = createService());
    queue.add.mockImplementation((_name: string, _data: unknown, opts: { jobId: string }) =>
      Promise.resolve({ id: opts.jobId, data: _data }),
    );
  });

  it('enqueues a job with the batchId as jobId and returns queued status', async () => {
    const dto = {
      employeeIds: ['emp-1', 'emp-2', 'emp-3'],
      letterType: LetterTypeDto.RAISE,
    };

    const result = await service.enqueueBatch(TEST_TENANT_ID, TEST_USER_ID, dto);

    expect(result.total).toBe(3);
    expect(result.status).toBe('queued');
    expect(result.batchId).toMatch(/^batch-\d+-[a-z0-9]+$/);
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = queue.add.mock.calls[0]!;
    expect(name).toBe('generate-letters');
    expect(data).toMatchObject({
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      batchId: result.batchId,
      dto,
    });
    expect(opts).toEqual({ jobId: result.batchId });
  });

  it('generates a different batchId on each call', async () => {
    const dto = { employeeIds: ['e1'], letterType: LetterTypeDto.BONUS };
    const a = await service.enqueueBatch(TEST_TENANT_ID, TEST_USER_ID, dto);
    const b = await service.enqueueBatch(TEST_TENANT_ID, TEST_USER_ID, dto);
    expect(a.batchId).not.toBe(b.batchId);
  });
});

describe('LettersService — runBatchJob', () => {
  let service: LettersService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('processes every employeeId, reports progress, and counts succeed/fail', async () => {
    // Stub generateLetter so we don't pull in LLM.
    let n = 0;
    const generateLetter = vi.spyOn(service, 'generateLetter').mockImplementation(async () => {
      n++;
      if (n === 2) throw new Error('LLM blew up');
      // Cast: only the .id field is used by the batch updater.
      return { id: `letter-${n}` } as never;
    });
    db.client.compensationLetter.update.mockResolvedValue({});

    const progressEvents: Array<[number, number]> = [];
    const result = await service.runBatchJob({
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      batchId: 'batch-test',
      dto: {
        employeeIds: ['e1', 'e2', 'e3', 'e4'],
        letterType: LetterTypeDto.RAISE,
      },
      onProgress: (done, total) => progressEvents.push([done, total]),
    });

    expect(generateLetter).toHaveBeenCalledTimes(4);
    expect(result.total).toBe(4);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(1);
    expect(progressEvents).toHaveLength(4);
    expect(progressEvents[progressEvents.length - 1]).toEqual([4, 4]);
  });

  it('tags successful letters with the batchId', async () => {
    vi.spyOn(service, 'generateLetter').mockResolvedValue({ id: 'letter-1' } as never);
    db.client.compensationLetter.update.mockResolvedValue({});

    await service.runBatchJob({
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      batchId: 'batch-X',
      dto: { employeeIds: ['e1'], letterType: LetterTypeDto.RAISE },
    });

    expect(db.client.compensationLetter.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'letter-1' },
        data: { batchId: 'batch-X' },
      }),
    );
  });

  it('handles empty employeeIds list cleanly', async () => {
    const result = await service.runBatchJob({
      tenantId: TEST_TENANT_ID,
      userId: TEST_USER_ID,
      batchId: 'batch-empty',
      dto: { employeeIds: [], letterType: LetterTypeDto.RAISE },
    });
    expect(result).toEqual({
      batchId: 'batch-empty',
      total: 0,
      succeeded: 0,
      failed: 0,
    });
  });
});

describe('LettersService — getBatchProgress', () => {
  let service: LettersService;
  let db: ReturnType<typeof createMockDatabaseService>;
  let queue: MockQueue;

  beforeEach(() => {
    ({ service, db, queue } = createService());
  });

  it('aggregates row counts by status and reflects job state', async () => {
    db.client.compensationLetter.groupBy.mockResolvedValue([
      { status: 'REVIEW', _count: { _all: 7 } },
      { status: 'GENERATING', _count: { _all: 2 } },
      { status: 'FAILED', _count: { _all: 1 } },
    ]);
    const job: MockJob = {
      id: 'batch-X',
      data: { dto: { employeeIds: Array.from({ length: 10 }, (_, i) => `e${i}`) } },
      progress: 90,
      getState: () => Promise.resolve('active'),
    };
    queue.getJob.mockResolvedValue(job);

    const result = await service.getBatchProgress(TEST_TENANT_ID, 'batch-X');

    expect(result.total).toBe(10);
    expect(result.seen).toBe(10);
    expect(result.succeeded).toBe(7);
    expect(result.inFlight).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.byStatus).toEqual({ REVIEW: 7, GENERATING: 2, FAILED: 1 });
    expect(result.jobState).toBe('active');
    expect(result.progress).toBe(90);
    expect(result.done).toBe(false);
  });

  it('marks done=true when job state is completed', async () => {
    db.client.compensationLetter.groupBy.mockResolvedValue([
      { status: 'REVIEW', _count: { _all: 1 } },
    ]);
    queue.getJob.mockResolvedValue({
      id: 'batch-Y',
      data: { dto: { employeeIds: ['e1'] } },
      progress: 100,
      getState: () => Promise.resolve('completed'),
    } satisfies MockJob);

    const result = await service.getBatchProgress(TEST_TENANT_ID, 'batch-Y');
    expect(result.done).toBe(true);
  });

  it('handles missing job (e.g. after retention sweep) gracefully', async () => {
    db.client.compensationLetter.groupBy.mockResolvedValue([
      { status: 'REVIEW', _count: { _all: 3 } },
    ]);
    queue.getJob.mockResolvedValue(null);

    const result = await service.getBatchProgress(TEST_TENANT_ID, 'batch-old');

    // No job → fall back to row count for total, jobState='not-found'.
    expect(result.total).toBe(3);
    expect(result.jobState).toBe('not-found');
    expect(result.done).toBe(false);
  });
});

// ─── Approval state machine ────────────────────────────────────────────────

interface MockLetter {
  id: string;
  userId: string;
  tenantId: string;
  status: string;
  metadata: Record<string, unknown>;
}

const HRBP_USER = { userId: 'user-hrbp', role: 'HRBP', name: 'Pat HRBP' };
const CHRO_USER = { userId: 'user-chro', role: 'CHRO', name: 'Sam CHRO' };

function letterFixture(overrides: Partial<MockLetter> = {}): MockLetter {
  return {
    id: 'letter-1',
    userId: 'user-author',
    tenantId: TEST_TENANT_ID,
    status: 'REVIEW',
    metadata: {},
    ...overrides,
  };
}

describe('LettersService — submitForApproval', () => {
  let service: LettersService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('snapshots tenant chain into letter metadata and starts at step 0', async () => {
    db.client.tenant.findUnique.mockResolvedValue({
      settings: {
        letterApprovalChain: [
          { role: 'HRBP', label: 'HR Business Partner' },
          { role: 'CHRO', label: 'CHRO' },
        ],
      },
    });
    db.client.compensationLetter.findFirst.mockResolvedValue(letterFixture());
    db.client.compensationLetter.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...letterFixture(), ...args.data }),
    );

    await service.submitForApproval(TEST_TENANT_ID, 'user-author', 'letter-1');

    const updateArgs = db.client.compensationLetter.update.mock.calls[0]![0];
    expect(updateArgs.data.metadata.approval).toMatchObject({
      chain: [
        { role: 'HRBP', label: 'HR Business Partner' },
        { role: 'CHRO', label: 'CHRO' },
      ],
      currentStep: 0,
      decisions: [],
      rejected: false,
      submittedBy: 'user-author',
    });
  });

  it('approves immediately when no chain is configured', async () => {
    db.client.tenant.findUnique.mockResolvedValue({ settings: {} });
    db.client.compensationLetter.findFirst.mockResolvedValue(letterFixture());
    db.client.compensationLetter.update.mockResolvedValue({});

    await service.submitForApproval(TEST_TENANT_ID, 'user-author', 'letter-1');

    const updateArgs = db.client.compensationLetter.update.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe('APPROVED');
    expect(updateArgs.data.approvedAt).toBeInstanceOf(Date);
  });

  it('rejects letters not in REVIEW status', async () => {
    db.client.tenant.findUnique.mockResolvedValue({ settings: {} });
    db.client.compensationLetter.findFirst.mockResolvedValue(letterFixture({ status: 'APPROVED' }));

    await expect(
      service.submitForApproval(TEST_TENANT_ID, 'user-author', 'letter-1'),
    ).rejects.toThrow(/REVIEW/);
  });

  it('throws NotFound for missing letter', async () => {
    db.client.tenant.findUnique.mockResolvedValue({ settings: {} });
    db.client.compensationLetter.findFirst.mockResolvedValue(null);

    await expect(
      service.submitForApproval(TEST_TENANT_ID, 'user-author', 'missing'),
    ).rejects.toThrow(/not found/);
  });
});

describe('LettersService — approveStep', () => {
  let service: LettersService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
    db.client.compensationLetter.update.mockImplementation(
      (args: { data: { metadata?: unknown; status?: unknown } }) =>
        Promise.resolve({
          ...letterFixture(),
          metadata: args.data.metadata as Record<string, unknown>,
          status: args.data.status as string,
        }),
    );
  });

  function submittedLetter(overrides: Partial<MockLetter> = {}): MockLetter {
    return letterFixture({
      metadata: {
        approval: {
          chain: [
            { role: 'HRBP', label: 'HR Business Partner' },
            { role: 'CHRO', label: 'CHRO' },
          ],
          currentStep: 0,
          decisions: [],
          rejected: false,
          submittedBy: 'user-author',
          submittedAt: '2026-04-27T00:00:00.000Z',
        },
      },
      ...overrides,
    });
  }

  it('advances current step on a non-final approval', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue(submittedLetter());

    await service.approveStep(TEST_TENANT_ID, HRBP_USER, 'letter-1', { comment: 'lgtm' });

    const updateArgs = db.client.compensationLetter.update.mock.calls[0]![0];
    expect(updateArgs.data.metadata.approval.currentStep).toBe(1);
    expect(updateArgs.data.metadata.approval.decisions).toHaveLength(1);
    expect(updateArgs.data.metadata.approval.decisions[0]).toMatchObject({
      stepIndex: 0,
      role: 'HRBP',
      decidedBy: HRBP_USER.userId,
      decision: 'APPROVED',
      comment: 'lgtm',
    });
    expect(updateArgs.data.status).toBeUndefined(); // status unchanged on intermediate step
  });

  it('marks the letter APPROVED on final-step approval', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue(
      submittedLetter({
        metadata: {
          approval: {
            chain: [{ role: 'CHRO', label: 'CHRO' }],
            currentStep: 0,
            decisions: [],
            rejected: false,
          },
        },
      }),
    );

    await service.approveStep(TEST_TENANT_ID, CHRO_USER, 'letter-1', {});

    const updateArgs = db.client.compensationLetter.update.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe('APPROVED');
    expect(updateArgs.data.approvedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.metadata.approval.currentStep).toBe(1);
  });

  it('forbids the author from approving their own letter', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue(submittedLetter());

    await expect(
      service.approveStep(TEST_TENANT_ID, { userId: 'user-author', role: 'HRBP' }, 'letter-1', {}),
    ).rejects.toThrow(/own letter/);
  });

  it("rejects when the user role doesn't match the current step", async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue(submittedLetter());

    await expect(
      service.approveStep(
        TEST_TENANT_ID,
        { userId: 'user-other', role: 'ENGINEER' },
        'letter-1',
        {},
      ),
    ).rejects.toThrow(/role/);
  });

  it('PLATFORM_ADMIN can approve any step regardless of role', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue(submittedLetter());

    await service.approveStep(
      TEST_TENANT_ID,
      { userId: 'user-admin', role: 'PLATFORM_ADMIN' },
      'letter-1',
      {},
    );
    expect(db.client.compensationLetter.update).toHaveBeenCalled();
  });

  it('refuses to advance after a rejection', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue(
      submittedLetter({
        metadata: {
          approval: {
            chain: [{ role: 'HRBP', label: 'HRBP' }],
            currentStep: 0,
            decisions: [
              {
                stepIndex: 0,
                role: 'HRBP',
                decidedBy: 'someone',
                decidedByName: 'Someone',
                decision: 'REJECTED',
                decidedAt: '2026-04-27T00:00:00.000Z',
              },
            ],
            rejected: true,
          },
        },
      }),
    );

    await expect(service.approveStep(TEST_TENANT_ID, HRBP_USER, 'letter-1', {})).rejects.toThrow(
      /rejected/,
    );
  });

  it('refuses if letter has not been submitted', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue(letterFixture());

    await expect(service.approveStep(TEST_TENANT_ID, HRBP_USER, 'letter-1', {})).rejects.toThrow(
      /submit/,
    );
  });
});

describe('LettersService — rejectStep', () => {
  let service: LettersService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createService());
  });

  it('flips rejected=true and records a rejection decision', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue(
      letterFixture({
        metadata: {
          approval: {
            chain: [{ role: 'HRBP', label: 'HRBP' }],
            currentStep: 0,
            decisions: [],
            rejected: false,
          },
        },
      }),
    );
    db.client.compensationLetter.update.mockImplementation(
      (args: { data: { metadata?: unknown } }) =>
        Promise.resolve({
          ...letterFixture(),
          metadata: args.data.metadata as Record<string, unknown>,
        }),
    );

    await service.rejectStep(TEST_TENANT_ID, HRBP_USER, 'letter-1', {
      reason: 'Comp band exceeded',
    });

    const updateArgs = db.client.compensationLetter.update.mock.calls[0]![0];
    expect(updateArgs.data.metadata.approval.rejected).toBe(true);
    expect(updateArgs.data.metadata.approval.decisions[0]).toMatchObject({
      decision: 'REJECTED',
      role: 'HRBP',
      comment: 'Comp band exceeded',
    });
    // Status stays REVIEW; the author must resubmit.
    expect(updateArgs.data.status).toBeUndefined();
  });

  it('refuses to reject twice', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue(
      letterFixture({
        metadata: {
          approval: {
            chain: [{ role: 'HRBP', label: 'HRBP' }],
            currentStep: 0,
            decisions: [
              {
                stepIndex: 0,
                role: 'HRBP',
                decidedBy: 'someone',
                decidedByName: 'Someone',
                decision: 'REJECTED',
                decidedAt: '2026-04-27T00:00:00.000Z',
              },
            ],
            rejected: true,
          },
        },
      }),
    );

    await expect(service.rejectStep(TEST_TENANT_ID, HRBP_USER, 'letter-1', {})).rejects.toThrow(
      /already rejected/,
    );
  });
});

// ─── Email delivery + acknowledgement ──────────────────────────────────────

describe('LettersService — sendLetter', () => {
  let service: LettersService;
  let db: ReturnType<typeof createMockDatabaseService>;
  let email: MockEmail;

  beforeEach(() => {
    ({ service, db, email } = createService());
  });

  it('refuses to send a letter that is not APPROVED', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue({
      id: 'letter-1',
      status: 'REVIEW',
      content: '<p>hi</p>',
      subject: 's',
      employee: { firstName: 'A', lastName: 'B', email: 'a@b.com' },
      metadata: {},
    });
    await expect(service.sendLetter(TEST_TENANT_ID, 'letter-1')).rejects.toThrow(/APPROVED/);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('refuses when employee has no email address', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue({
      id: 'letter-1',
      status: 'APPROVED',
      content: '<p>hi</p>',
      subject: 's',
      employee: { firstName: 'A', lastName: 'B', email: null },
      metadata: {},
    });
    await expect(service.sendLetter(TEST_TENANT_ID, 'letter-1')).rejects.toThrow(/email/);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('returns 503-mapped error when SMTP is not configured', async () => {
    email.isConfigured.mockReturnValue(false);
    db.client.compensationLetter.findFirst.mockResolvedValue({
      id: 'letter-1',
      status: 'APPROVED',
      content: '<p>hi</p>',
      subject: 's',
      employee: { firstName: 'A', lastName: 'B', email: 'a@b.com' },
      metadata: {},
    });
    await expect(service.sendLetter(TEST_TENANT_ID, 'letter-1')).rejects.toThrow(/not configured/);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('sends, marks SENT, and persists email metadata', async () => {
    db.client.compensationLetter.findFirst.mockResolvedValue({
      id: 'letter-1',
      status: 'APPROVED',
      subject: 'Your raise',
      content: '<p>congrats</p>',
      employee: { firstName: 'A', lastName: 'B', email: 'a@b.com' },
      metadata: {},
    });
    db.client.compensationLetter.update.mockImplementation(
      (args: { data: { metadata?: unknown; status?: unknown } }) =>
        Promise.resolve({ id: 'letter-1', ...args.data }),
    );

    await service.sendLetter(TEST_TENANT_ID, 'letter-1');

    expect(email.send).toHaveBeenCalledTimes(1);
    const sendArgs = email.send.mock.calls[0]![0];
    expect(sendArgs.to).toBe('a@b.com');
    expect(sendArgs.subject).toBe('Your raise');
    expect(sendArgs.html).toContain('<p>congrats</p>');
    expect(sendArgs.html).toContain('Acknowledge receipt');

    const updateArgs = db.client.compensationLetter.update.mock.calls[0]![0];
    expect(updateArgs.data.status).toBe('SENT');
    expect(updateArgs.data.sentAt).toBeInstanceOf(Date);
    expect(updateArgs.data.metadata.email).toMatchObject({
      to: 'a@b.com',
      messageId: 'msg-1',
    });
  });
});

describe('LettersService — acknowledgeLetter', () => {
  let service: LettersService;
  let db: ReturnType<typeof createMockDatabaseService>;
  let email: MockEmail;

  beforeEach(() => {
    ({ service, db, email } = createService());
  });

  it('rejects an invalid token', async () => {
    email.verifyAckToken.mockReturnValue(null);
    await expect(service.acknowledgeLetter('garbage')).rejects.toThrow(/Invalid/);
  });

  it('records acknowledgedAt on first acknowledgement', async () => {
    email.verifyAckToken.mockReturnValue({ tenantId: TEST_TENANT_ID, letterId: 'letter-1' });
    db.client.compensationLetter.findFirst.mockResolvedValue({
      id: 'letter-1',
      employee: { firstName: 'Alex' },
      metadata: { email: { to: 'a@b.com', sentAt: '2026-04-27T00:00:00Z', messageId: 'm1' } },
    });
    db.client.compensationLetter.update.mockResolvedValue({});

    const result = await service.acknowledgeLetter('signed-token');

    expect(result.alreadyAcknowledged).toBe(false);
    expect(result.firstName).toBe('Alex');
    const updateArgs = db.client.compensationLetter.update.mock.calls[0]![0];
    expect(updateArgs.data.metadata.email.acknowledgedAt).toBeTruthy();
    expect(updateArgs.data.metadata.email.to).toBe('a@b.com');
  });

  it('is idempotent — second ack returns existing timestamp without DB write', async () => {
    email.verifyAckToken.mockReturnValue({ tenantId: TEST_TENANT_ID, letterId: 'letter-1' });
    db.client.compensationLetter.findFirst.mockResolvedValue({
      id: 'letter-1',
      employee: { firstName: 'Alex' },
      metadata: {
        email: {
          to: 'a@b.com',
          sentAt: '2026-04-27T00:00:00Z',
          messageId: 'm1',
          acknowledgedAt: '2026-04-27T01:00:00Z',
        },
      },
    });

    const result = await service.acknowledgeLetter('signed-token');

    expect(result.alreadyAcknowledged).toBe(true);
    expect(result.acknowledgedAt).toBe('2026-04-27T01:00:00Z');
    expect(db.client.compensationLetter.update).not.toHaveBeenCalled();
  });
});

describe('LetterEmailService — token round trip', () => {
  it('signs and verifies an HMAC token; tampering fails', async () => {
    const config = {
      get: (k: string) =>
        ({
          EMAIL_TOKEN_SECRET: 'a'.repeat(32),
          APP_BASE_URL: 'https://example.com',
        })[k],
    } as unknown as ConfigService;
    const svc = new LetterEmailService(config);
    const token = svc.signAckToken('letter-1', 'tenant-1');
    const ok = svc.verifyAckToken(token);
    expect(ok).toEqual({ tenantId: 'tenant-1', letterId: 'letter-1' });
    expect(svc.verifyAckToken('not.a.real.token')).toBeNull();
    expect(svc.verifyAckToken(token + 'x')).toBeNull();
  });

  it('refuses to operate without a sufficiently long secret', async () => {
    const config = {
      get: (k: string) => (k === 'EMAIL_TOKEN_SECRET' ? 'short' : undefined),
    } as unknown as ConfigService;
    const svc = new LetterEmailService(config);
    expect(() => svc.signAckToken('a', 'b')).toThrow(/EMAIL_TOKEN_SECRET/);
  });

  it('isConfigured is true only when SMTP_HOST is set', async () => {
    const a = new LetterEmailService({ get: () => undefined } as unknown as ConfigService);
    expect(a.isConfigured()).toBe(false);
    const b = new LetterEmailService({
      get: (k: string) => (k === 'SMTP_HOST' ? 'smtp.local' : undefined),
    } as unknown as ConfigService);
    expect(b.isConfigured()).toBe(true);
  });
});
