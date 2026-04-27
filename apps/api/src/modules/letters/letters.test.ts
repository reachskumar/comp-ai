import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LettersService } from './letters.service';
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

function createService() {
  const db = createMockDatabaseService();
  const queue = createMockQueue();
  // Bypass NestJS DI for unit tests; LettersService implements OnModuleInit but
  // we don't trigger init here (no Chrome probe / reaper) — we just test pure
  // batch coordination.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new (LettersService as any)(db, queue) as LettersService;
  return { service, db, queue };
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
