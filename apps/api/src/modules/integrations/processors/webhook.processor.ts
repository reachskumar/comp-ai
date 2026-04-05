import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  WebhookDeliveryService,
  WebhookEvent,
} from '../services/webhook-delivery.service';

export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';

export interface WebhookDeliveryJobData {
  tenantId: string;
  eventType: WebhookEvent;
  payload: Record<string, unknown>;
}

/**
 * Webhook Delivery BullMQ Processor.
 *
 * Processes outbound webhook deliveries asynchronously.
 * Each job fans out to all active endpoints subscribed to the event.
 *
 * Concurrency is set to 5 to allow parallel delivery of different events,
 * while individual endpoint retries are handled sequentially within
 * WebhookDeliveryService.
 */
@Processor(WEBHOOK_DELIVERY_QUEUE, {
  concurrency: 5,
})
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly webhookDeliveryService: WebhookDeliveryService,
  ) {
    super();
  }

  async process(
    job: Job<WebhookDeliveryJobData>,
  ): Promise<{
    success: boolean;
    deliveredCount: number;
    failedCount: number;
    results: Array<{ endpointId: string; success: boolean; error?: string }>;
  }> {
    const { tenantId, eventType, payload } = job.data;

    this.logger.log(
      `Processing webhook delivery job ${job.id}: event=${eventType}, tenant=${tenantId}`,
    );

    try {
      const results = await this.webhookDeliveryService.deliverEvent(
        tenantId,
        eventType,
        payload,
      );

      const deliveredCount = results.filter((r) => r.success).length;
      const failedCount = results.filter((r) => !r.success).length;

      this.logger.log(
        `Webhook delivery job ${job.id} completed: ${deliveredCount} delivered, ${failedCount} failed`,
      );

      return {
        success: failedCount === 0,
        deliveredCount,
        failedCount,
        results: results.map((r) => ({
          endpointId: r.endpointId,
          success: r.success,
          ...(r.error ? { error: r.error } : {}),
        })),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Webhook delivery job ${job.id} failed: ${errorMessage.substring(0, 500)}`,
      );
      throw error;
    }
  }
}
