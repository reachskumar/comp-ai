/**
 * Webhook Types
 * Types for inbound and outbound webhook handling.
 */

export type WebhookDirection = 'inbound' | 'outbound';

export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  source: string;
}

export interface WebhookDelivery {
  id: string;
  webhookEndpointId: string;
  event: WebhookEvent;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastAttemptAt?: Date;
  nextRetryAt?: Date;
  responseStatus?: number;
  responseBody?: string;
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying';

export interface WebhookSignatureConfig {
  algorithm: 'sha256';
  headerName: string;
  secret: string;
}

export interface InboundWebhookPayload {
  headers: Record<string, string>;
  body: unknown;
  signature?: string;
}

export interface OutboundWebhookConfig {
  url: string;
  events: string[];
  secret: string;
  /** TLS-only endpoints required */
  requireTls: boolean;
  /** Retry configuration */
  retryConfig: RetryConfig;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 300000, // 5 minutes
  backoffMultiplier: 2,
};

