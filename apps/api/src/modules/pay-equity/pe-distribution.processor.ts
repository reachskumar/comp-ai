/**
 * Phase 3.7 + 6.4 — Cron processor for due Pay Equity subscriptions.
 *
 * On module init, schedules a repeatable BullMQ job that runs every hour.
 * Each tick calls PEDistributionService.runDueSubscriptions() which scans
 * the table for nextRunAt <= now and dispatches them.
 *
 * Idempotent: if a tick is delayed and runs twice in quick succession, the
 * second run finds no due rows because the first one bumped nextRunAt.
 */
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PEDistributionService } from './pe-distribution.service';

export const PE_DISTRIBUTION_QUEUE = 'pe-distribution';
const REPEAT_EVERY_MS = 60 * 60 * 1000; // 1 hour
const REPEATABLE_JOB_NAME = 'pe-distribution-tick';

interface TickResult {
  dispatched: number;
  failed: number;
  scanned: number;
}

@Processor(PE_DISTRIBUTION_QUEUE)
export class PEDistributionProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PEDistributionProcessor.name);

  constructor(
    private readonly distribution: PEDistributionService,
    @InjectQueue(PE_DISTRIBUTION_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    // Best-effort schedule: ignore failures (queue may not be reachable in
    // dev/tests). Production has a real Redis behind the BullModule config.
    try {
      // Remove any prior repeatable to avoid stale schedules from older code.
      const existing = await this.queue.getRepeatableJobs();
      for (const job of existing) {
        if (job.name === REPEATABLE_JOB_NAME) {
          await this.queue.removeRepeatableByKey(job.key);
        }
      }
      await this.queue.add(
        REPEATABLE_JOB_NAME,
        {},
        {
          repeat: { every: REPEAT_EVERY_MS },
          removeOnComplete: { count: 24 },
          removeOnFail: { count: 24 },
        },
      );
      this.logger.log(`Scheduled ${REPEATABLE_JOB_NAME} every ${REPEAT_EVERY_MS}ms`);
    } catch (err) {
      this.logger.warn(`Could not schedule ${REPEATABLE_JOB_NAME}: ${(err as Error).message}`);
    }
  }

  async process(_job: Job): Promise<TickResult> {
    const result = await this.distribution.runDueSubscriptions();
    if (result.dispatched > 0 || result.failed > 0) {
      this.logger.log(
        `Tick: scanned=${result.scanned} dispatched=${result.dispatched} failed=${result.failed}`,
      );
    }
    return result;
  }
}
