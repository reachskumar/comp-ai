import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WriteBackService } from '../services/write-back.service';

export const WRITE_BACK_QUEUE = 'compport-write-back';

export interface WriteBackJobData {
  tenantId: string;
  batchId: string;
  userId: string;
  confirmPhrase: string;
  selectedRecordIds?: string[];
}

/**
 * Write-Back BullMQ Processor.
 *
 * Processes approved write-back batches in the background.
 * Concurrency = 1 per tenant to prevent race conditions.
 *
 * SECURITY:
 * - Job data contains only IDs, not credentials
 * - Credentials are fetched and decrypted at execution time
 * - Error messages are truncated to prevent credential leakage
 */
@Processor(WRITE_BACK_QUEUE, {
  concurrency: 1,
  limiter: { max: 1, duration: 60_000 }, // max 1 job per minute (safety)
})
export class WriteBackProcessor extends WorkerHost {
  private readonly logger = new Logger(WriteBackProcessor.name);

  constructor(private readonly writeBackService: WriteBackService) {
    super();
  }

  async process(
    job: Job<WriteBackJobData>,
  ): Promise<{ success: boolean; appliedRecords: number; skippedRecords: number }> {
    const { tenantId, batchId, userId, confirmPhrase, selectedRecordIds } = job.data;

    this.logger.log(`Processing write-back job ${job.id}: batch=${batchId}, tenant=${tenantId}`);

    try {
      const result = await this.writeBackService.applyBatch(
        tenantId,
        batchId,
        userId,
        confirmPhrase,
        selectedRecordIds,
      );

      this.logger.log(
        `Write-back job ${job.id} completed: ${result.appliedRecords} applied, ${result.skippedRecords} skipped`,
      );

      return {
        success: true,
        appliedRecords: result.appliedRecords,
        skippedRecords: result.skippedRecords,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Write-back job ${job.id} failed: ${errorMessage.substring(0, 500)}`);
      throw error;
    }
  }
}
