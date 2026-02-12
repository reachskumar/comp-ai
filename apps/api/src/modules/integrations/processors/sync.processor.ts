import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DatabaseService } from '../../../database';

interface SyncJobData {
  syncJobId: string;
  connectorId: string;
  tenantId: string;
  entityType: string;
  direction: string;
  since?: string;
  batchSize: number;
}

/**
 * Sync Processor
 * Processes sync jobs from the BullMQ queue.
 * This is the framework — actual connector-specific logic will be
 * implemented per connector type in future waves.
 */
@Processor('integration-sync')
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(private readonly db: DatabaseService) {
    super();
  }

  async process(job: Job<SyncJobData>): Promise<{ success: boolean; stats: Record<string, number> }> {
    const { syncJobId, connectorId, tenantId, entityType, direction } = job.data;
    this.logger.log(`Processing sync job ${syncJobId} for connector ${connectorId}`);

    try {
      // Mark job as running
      await this.db.client.syncJob.update({
        where: { id: syncJobId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });

      // Get connector config (credentials are encrypted, don't log them)
      const connector = await this.db.client.integrationConnector.findFirst({
        where: { id: connectorId, tenantId },
      });

      if (!connector) {
        throw new Error(`Connector ${connectorId} not found for tenant ${tenantId}`);
      }

      // Framework placeholder: actual sync logic depends on connector type.
      // Each connector type will implement the IConnector interface.
      // For now, we log and mark as completed.
      this.logger.log(
        `Sync job ${syncJobId}: type=${connector.connectorType}, entity=${entityType}, direction=${direction}`,
      );

      // Mark job as completed
      await this.db.client.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          totalRecords: 0,
          processedRecords: 0,
          failedRecords: 0,
          skippedRecords: 0,
        },
      });

      // Update connector's last sync timestamp
      await this.db.client.integrationConnector.update({
        where: { id: connectorId },
        data: { lastSyncAt: new Date() },
      });

      return {
        success: true,
        stats: { total: 0, processed: 0, failed: 0, skipped: 0 },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Sync job ${syncJobId} failed: ${errorMessage}`);

      // Mark job as failed — never include credentials in error messages
      await this.db.client.syncJob.update({
        where: { id: syncJobId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: errorMessage.substring(0, 500), // Truncate long errors
        },
      });

      throw error;
    }
  }
}

