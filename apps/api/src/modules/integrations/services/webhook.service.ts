import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../../../database';
import { CreateWebhookDto } from '../dto/create-webhook.dto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly db: DatabaseService) {}

  async create(tenantId: string, dto: CreateWebhookDto) {
    // Verify connector belongs to tenant
    const connector = await this.db.client.integrationConnector.findFirst({
      where: { id: dto.connectorId, tenantId },
    });
    if (!connector) {
      throw new NotFoundException(`Connector ${dto.connectorId} not found`);
    }

    // Outbound webhooks must use HTTPS
    if (dto.direction === 'outbound' && !dto.url.startsWith('https://')) {
      throw new BadRequestException('Outbound webhooks require HTTPS URLs');
    }

    // Generate a secret for HMAC signing
    const secret = crypto.randomBytes(32).toString('hex');
    const secretHash = crypto
      .createHash('sha256')
      .update(secret)
      .digest('hex');

    const webhook = await this.db.client.webhookEndpoint.create({
      data: {
        connectorId: dto.connectorId,
        tenantId,
        url: dto.url,
        direction: dto.direction ?? 'inbound',
        events: dto.events,
        secretHash,
        metadata: {},
      },
    });

    this.logger.log(`Webhook endpoint created: ${webhook.id}`);

    // Return the secret only on creation — it won't be shown again
    return {
      ...webhook,
      secret,
      secretHash: undefined,
      message: 'Save this secret — it will not be shown again.',
    };
  }

  async findByConnector(tenantId: string, connectorId: string) {
    const connector = await this.db.client.integrationConnector.findFirst({
      where: { id: connectorId, tenantId },
    });
    if (!connector) {
      throw new NotFoundException(`Connector ${connectorId} not found`);
    }

    const webhooks = await this.db.client.webhookEndpoint.findMany({
      where: { connectorId, tenantId },
      orderBy: { createdAt: 'desc' },
    });

    // Never expose secretHash in list responses
    return webhooks.map((w: Record<string, unknown>) => {
      const { secretHash, ...safe } = w;
      return safe;
    });
  }

  async delete(tenantId: string, id: string) {
    const webhook = await this.db.client.webhookEndpoint.findFirst({
      where: { id, tenantId },
    });
    if (!webhook) {
      throw new NotFoundException(`Webhook endpoint ${id} not found`);
    }
    await this.db.client.webhookEndpoint.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Process an inbound webhook.
   * Verifies HMAC-SHA256 signature using constant-time comparison.
   */
  async processInbound(
    connectorId: string,
    signature: string | undefined,
    body: unknown,
  ) {
    const webhook = await this.db.client.webhookEndpoint.findFirst({
      where: { connectorId, direction: 'inbound', isActive: true },
    });

    if (!webhook) {
      throw new NotFoundException(`No active inbound webhook for connector ${connectorId}`);
    }

    // HMAC verification is REQUIRED — reject if no signature
    if (!signature) {
      throw new ForbiddenException('Missing webhook signature');
    }

    // Verify HMAC-SHA256 signature with constant-time comparison
    const verified = this.verifyHmacSignature(
      webhook.secretHash!,
      signature,
      body,
    );

    if (!verified) {
      this.logger.warn(`Invalid webhook signature for connector ${connectorId}`);
      throw new ForbiddenException('Invalid webhook signature');
    }

    // Update last triggered timestamp
    await this.db.client.webhookEndpoint.update({
      where: { id: webhook.id },
      data: { lastTriggeredAt: new Date() },
    });

    this.logger.log(`Inbound webhook processed for connector ${connectorId}`);

    return { received: true, connectorId };
  }

  /**
   * Sign an outbound webhook payload with HMAC-SHA256.
   * Includes idempotency key. Never includes credentials.
   */
  signOutboundPayload(
    secret: string,
    payload: Record<string, unknown>,
  ): { signature: string; idempotencyKey: string; signedPayload: Record<string, unknown> } {
    const idempotencyKey = crypto.randomUUID();
    const timestamp = Date.now();

    // Payload to sign — never include credentials
    const signedPayload = {
      ...payload,
      _idempotencyKey: idempotencyKey,
      _timestamp: timestamp,
    };

    const payloadStr = JSON.stringify(signedPayload);
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payloadStr)
      .digest('hex');

    return { signature, idempotencyKey, signedPayload };
  }

  /**
   * Verify HMAC-SHA256 signature using constant-time comparison.
   * Prevents timing attacks.
   */
  private verifyHmacSignature(
    secretHash: string,
    providedSignature: string,
    body: unknown,
  ): boolean {
    try {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      // Compute expected signature using the stored secret hash
      const expectedSignature = crypto
        .createHmac('sha256', secretHash)
        .update(bodyStr)
        .digest('hex');

      // Constant-time comparison to prevent timing attacks
      const expectedBuf = Buffer.from(expectedSignature, 'hex');
      const providedBuf = Buffer.from(providedSignature, 'hex');

      if (expectedBuf.length !== providedBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuf, providedBuf);
    } catch {
      return false;
    }
  }
}

