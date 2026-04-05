import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../../../database';

/**
 * Webhook event types emitted by the compensation platform.
 * Compport subscribes to these to stay informed when AI insights
 * are ready, write-backs complete, syncs finish, etc.
 */
export type WebhookEvent =
  | 'sync.completed'
  | 'sync.failed'
  | 'writeback.applied'
  | 'writeback.failed'
  | 'writeback.rollback'
  | 'ai.insights_ready'
  | 'compliance.scan_completed'
  | 'cycle.status_changed';

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'sync.completed',
  'sync.failed',
  'writeback.applied',
  'writeback.failed',
  'writeback.rollback',
  'ai.insights_ready',
  'compliance.scan_completed',
  'cycle.status_changed',
];

/** Maximum consecutive failures before auto-disabling a webhook endpoint. */
const MAX_FAILURE_COUNT = 10;

/** HTTP timeout for each delivery attempt (ms). */
const DELIVERY_TIMEOUT_MS = 10_000;

/** Maximum number of delivery attempts per webhook. */
const MAX_ATTEMPTS = 3;

/** Base delay for exponential backoff (ms). */
const BASE_BACKOFF_MS = 1_000;

interface DeliveryResult {
  endpointId: string;
  url: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
}

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Deliver an event to all active outbound webhook endpoints for a tenant
   * that are subscribed to the given event type.
   *
   * Each delivery is attempted up to 3 times with exponential backoff.
   * On success, failureCount resets to 0. On failure, failureCount increments;
   * the endpoint is disabled after 10 consecutive failures.
   */
  async deliverEvent(
    tenantId: string,
    eventType: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<DeliveryResult[]> {
    // Find all active outbound endpoints subscribed to this event
    const endpoints = await this.db.forTenant(tenantId, async (tx) => {
      return tx.webhookEndpoint.findMany({
        where: {
          tenantId,
          direction: 'outbound',
          isActive: true,
        },
      });
    });

    // Filter endpoints that subscribe to this event type.
    // events is stored as Json (string[]).
    const subscribedEndpoints = endpoints.filter((ep) => {
      const events = ep.events as string[];
      return Array.isArray(events) && events.includes(eventType);
    });

    if (subscribedEndpoints.length === 0) {
      this.logger.debug(
        `No active outbound webhooks for tenant=${tenantId}, event=${eventType}`,
      );
      return [];
    }

    this.logger.log(
      `Delivering event ${eventType} to ${subscribedEndpoints.length} endpoint(s) for tenant=${tenantId}`,
    );

    const results: DeliveryResult[] = [];

    for (const endpoint of subscribedEndpoints) {
      const result = await this.deliverToEndpoint(endpoint, eventType, payload);
      results.push(result);
    }

    return results;
  }

  /**
   * Deliver a single event to one endpoint with retry logic.
   */
  private async deliverToEndpoint(
    endpoint: {
      id: string;
      url: string;
      secretHash: string | null;
      failureCount: number;
      tenantId: string;
    },
    eventType: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    const eventPayload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    };

    const body = JSON.stringify(eventPayload);
    const signature = this.computeSignature(endpoint.secretHash, body);

    let lastError: string | undefined;
    let lastStatusCode: number | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

        try {
          const response = await fetch(endpoint.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Signature': signature,
              'X-Webhook-Event': eventType,
              'X-Webhook-Delivery-Attempt': String(attempt),
            },
            body,
            signal: controller.signal,
          });

          lastStatusCode = response.status;

          if (response.ok) {
            // Success — reset failure count and update last triggered
            await this.markSuccess(endpoint.id, endpoint.tenantId);

            this.logger.log(
              `Webhook delivered to ${endpoint.url} (status=${response.status}, attempt=${attempt})`,
            );

            return {
              endpointId: endpoint.id,
              url: endpoint.url,
              success: true,
              statusCode: response.status,
              attempts: attempt,
            };
          }

          // Non-2xx response — treat as failure for this attempt
          lastError = `HTTP ${response.status}`;
          this.logger.warn(
            `Webhook delivery to ${endpoint.url} returned ${response.status} (attempt ${attempt}/${MAX_ATTEMPTS})`,
          );
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = 'Request timed out';
        } else {
          lastError = error instanceof Error ? error.message : 'Unknown error';
        }

        this.logger.warn(
          `Webhook delivery to ${endpoint.url} failed: ${lastError} (attempt ${attempt}/${MAX_ATTEMPTS})`,
        );
      }

      // Exponential backoff before next attempt (skip after last attempt)
      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }

    // All attempts exhausted — increment failure count
    await this.markFailure(endpoint.id, endpoint.tenantId, endpoint.failureCount);

    return {
      endpointId: endpoint.id,
      url: endpoint.url,
      success: false,
      statusCode: lastStatusCode,
      error: lastError,
      attempts: MAX_ATTEMPTS,
    };
  }

  /**
   * Compute HMAC-SHA256 signature for the payload body.
   */
  private computeSignature(secretHash: string | null, body: string): string {
    if (!secretHash) {
      return '';
    }
    return crypto.createHmac('sha256', secretHash).update(body).digest('hex');
  }

  /**
   * Mark an endpoint delivery as successful:
   * - Reset failureCount to 0
   * - Update lastTriggeredAt
   */
  private async markSuccess(endpointId: string, tenantId: string): Promise<void> {
    await this.db.forTenant(tenantId, async (tx) => {
      await tx.webhookEndpoint.update({
        where: { id: endpointId },
        data: {
          failureCount: 0,
          lastTriggeredAt: new Date(),
        },
      });
    });
  }

  /**
   * Mark an endpoint delivery as failed:
   * - Increment failureCount
   * - Update lastTriggeredAt
   * - Disable endpoint if failureCount reaches MAX_FAILURE_COUNT
   */
  private async markFailure(
    endpointId: string,
    tenantId: string,
    currentFailureCount: number,
  ): Promise<void> {
    const newFailureCount = currentFailureCount + 1;
    const shouldDisable = newFailureCount >= MAX_FAILURE_COUNT;

    await this.db.forTenant(tenantId, async (tx) => {
      await tx.webhookEndpoint.update({
        where: { id: endpointId },
        data: {
          failureCount: newFailureCount,
          lastTriggeredAt: new Date(),
          ...(shouldDisable ? { isActive: false } : {}),
        },
      });
    });

    if (shouldDisable) {
      this.logger.warn(
        `Webhook endpoint ${endpointId} disabled after ${MAX_FAILURE_COUNT} consecutive failures`,
      );
    }
  }

  /**
   * Send a test event to a specific webhook endpoint.
   * Does NOT affect failureCount or isActive status.
   */
  async sendTestEvent(
    tenantId: string,
    endpointId: string,
  ): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    const endpoint = await this.db.forTenant(tenantId, async (tx) => {
      return tx.webhookEndpoint.findFirst({
        where: { id: endpointId, tenantId },
      });
    });

    if (!endpoint) {
      return { success: false, error: 'Webhook endpoint not found' };
    }

    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test webhook delivery.',
        endpointId: endpoint.id,
      },
    };

    const body = JSON.stringify(testPayload);
    const signature = this.computeSignature(endpoint.secretHash, body);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': 'test',
          },
          body,
          signal: controller.signal,
        });

        return {
          success: response.ok,
          statusCode: response.status,
          ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error && error.name === 'AbortError'
          ? 'Request timed out'
          : error instanceof Error
            ? error.message
            : 'Unknown error';

      return { success: false, error: errorMessage };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
