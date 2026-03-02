import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InboundSyncService, type InboundSyncResult } from '../services/inbound-sync.service';

export const INBOUND_SYNC_QUEUE = 'compport-inbound-sync';

export interface InboundSyncJobData {
  tenantId: string;
  connectorId: string;
  entityType: 'employee' | 'all';
  syncJobId: string;
}

/**
 * Inbound Sync BullMQ Processor.
 *
 * Processes Cloud SQL → PostgreSQL sync jobs in the background.
 * Concurrency = 2 (multiple tenants in parallel, but one job per tenant via unique job IDs).
 *
 * Retry: 3 attempts with exponential backoff.
 *
 * SECURITY:
 * - Job data contains only IDs, not credentials
 * - Credentials are fetched and decrypted at execution time
 * - Error messages are truncated to prevent credential leakage
 */
@Processor(INBOUND_SYNC_QUEUE, {
  concurrency: 2,
})
export class InboundSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(InboundSyncProcessor.name);

  constructor(private readonly inboundSyncService: InboundSyncService) {
    super();
  }

  async process(job: Job<InboundSyncJobData>): Promise<InboundSyncResult> {
    const { tenantId, connectorId, syncJobId } = job.data;

    this.logger.log(
      `Processing inbound sync job ${job.id}: tenant=${tenantId}, connector=${connectorId}`,
    );

    try {
      const result = await this.inboundSyncService.syncAll(tenantId, connectorId, syncJobId);

      this.logger.log(
        `Inbound sync job ${job.id} completed: synced=${result.processedRecords}, failed=${result.failedRecords}`,
      );

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Inbound sync job ${job.id} failed: ${errorMessage.substring(0, 500)}`);
      throw error;
    }
  }
}
