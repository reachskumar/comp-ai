import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from '../../../database';
import { TriggerSyncDto } from '../dto/trigger-sync.dto';
import { ConnectorQueryDto, SyncLogQueryDto } from '../dto/connector-query.dto';

/** Rate limit: max 10 manual syncs per hour per tenant */
const MANUAL_SYNC_RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class SyncEngineService {
  private readonly logger = new Logger(SyncEngineService.name);

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue('integration-sync') private readonly syncQueue: Queue,
  ) {}

  async triggerSync(tenantId: string, connectorId: string, dto: TriggerSyncDto) {
    // Verify connector exists and belongs to tenant
    const connector = await this.db.client.integrationConnector.findFirst({
      where: { id: connectorId, tenantId },
    });
    if (!connector) {
      throw new NotFoundException(`Connector ${connectorId} not found`);
    }
    if (connector.status === 'INACTIVE' || connector.status === 'ERROR') {
      throw new BadRequestException(`Connector is ${connector.status}. Activate it first.`);
    }

    // Rate limit manual syncs
    await this.checkRateLimit(tenantId);

    // Create sync job record
    const syncJob = await this.db.client.syncJob.create({
      data: {
        connectorId,
        tenantId,
        direction: (dto.direction as never) ?? connector.syncDirection,
        entityType: dto.entityType,
        status: 'PENDING',
        metadata: {
          since: dto.since ?? null,
          batchSize: dto.batchSize ?? 100,
          triggeredBy: 'manual',
        },
      },
    });

    // Queue the sync job for async processing
    await this.syncQueue.add(
      'process-sync',
      {
        syncJobId: syncJob.id,
        connectorId,
        tenantId,
        entityType: dto.entityType,
        direction: dto.direction ?? connector.syncDirection,
        since: dto.since,
        batchSize: dto.batchSize ?? 100,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log(`Sync job ${syncJob.id} queued for connector ${connectorId}`);

    return {
      syncJobId: syncJob.id,
      status: 'PENDING',
      message: 'Sync job queued for processing',
    };
  }

  async listSyncJobs(tenantId: string, connectorId: string, query: ConnectorQueryDto) {
    // Verify connector belongs to tenant
    const connector = await this.db.client.integrationConnector.findFirst({
      where: { id: connectorId, tenantId },
    });
    if (!connector) {
      throw new NotFoundException(`Connector ${connectorId} not found`);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where = { connectorId, tenantId };

    const [data, total] = await Promise.all([
      this.db.client.syncJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.client.syncJob.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getSyncLogs(tenantId: string, connectorId: string, query: SyncLogQueryDto) {
    // Verify connector belongs to tenant
    const connector = await this.db.client.integrationConnector.findFirst({
      where: { id: connectorId, tenantId },
    });
    if (!connector) {
      throw new NotFoundException(`Connector ${connectorId} not found`);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      syncJob: { connectorId, tenantId },
    };
    if (query.action) where['action'] = query.action;

    const [data, total] = await Promise.all([
      this.db.client.syncLog.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.client.syncLog.count({ where: where as never }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  private async checkRateLimit(tenantId: string): Promise<void> {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentSyncs = await this.db.client.syncJob.count({
      where: {
        tenantId,
        createdAt: { gte: windowStart },
      },
    });

    if (recentSyncs >= MANUAL_SYNC_RATE_LIMIT) {
      throw new BadRequestException(
        `Rate limit exceeded: max ${MANUAL_SYNC_RATE_LIMIT} manual syncs per hour. Try again later.`,
      );
    }
  }
}

