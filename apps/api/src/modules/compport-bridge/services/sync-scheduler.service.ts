import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../../database';
import { InboundSyncService } from './inbound-sync.service';
import { ConnectionManagerService } from './connection-manager.service';

export const REALTIME_SYNC_QUEUE = 'compport-realtime-sync';

interface RealtimeSyncJobData {
  tenantId: string;
  connectorId: string;
}

/**
 * Sync Scheduler Service
 *
 * Automatically triggers incremental sync for all active tenants at a
 * configurable interval (default: every 2 minutes).
 *
 * Features:
 * - Discovers all tenants with active COMPPORT_CLOUDSQL connectors
 * - Creates repeatable BullMQ jobs per tenant
 * - Prevents concurrent syncs for the same tenant
 * - Supports pause/resume per tenant
 * - Starts persistent connections on boot
 */
@Injectable()
export class SyncSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SyncSchedulerService.name);
  private readonly syncIntervalMs: number;
  private readonly pausedTenants = new Set<string>();

  constructor(
    @InjectQueue(REALTIME_SYNC_QUEUE) private readonly syncQueue: Queue,
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
    private readonly connectionManager: ConnectionManagerService,
  ) {
    const seconds = parseInt(this.configService.get('SYNC_INTERVAL_SECONDS', '120'), 10);
    this.syncIntervalMs = seconds * 1000;
    this.logger.log(`Sync interval configured: ${seconds}s`);
  }

  async onModuleInit(): Promise<void> {
    // Start health checks for persistent connections
    this.connectionManager.startHealthChecks();

    // Discover tenants and set up repeatable jobs
    await this.initializeSchedules();
  }

  /**
   * Find all tenants with active COMPPORT_CLOUDSQL connectors
   * and create repeatable sync jobs for each.
   */
  async initializeSchedules(): Promise<void> {
    try {
      // Cross-tenant query to find all active connectors
      const connectors = await this.db.client.integrationConnector.findMany({
        where: {
          connectorType: 'COMPPORT_CLOUDSQL',
          status: 'ACTIVE',
        },
        select: { id: true, tenantId: true },
      });

      this.logger.log(`Found ${connectors.length} active COMPPORT_CLOUDSQL connector(s)`);

      // Remove old repeatable jobs first
      const existingRepeatable = await this.syncQueue.getRepeatableJobs();
      for (const job of existingRepeatable) {
        await this.syncQueue.removeRepeatableByKey(job.key);
      }

      // Create a repeatable job per tenant
      for (const connector of connectors) {
        await this.addTenantSchedule(connector.tenantId, connector.id);
      }

      // Pre-connect all tenants
      const connectResults = await Promise.allSettled(
        connectors.map((c) => this.connectionManager.connect(c.tenantId)),
      );
      const connected = connectResults.filter((r) => r.status === 'fulfilled').length;
      const failed = connectResults.filter((r) => r.status === 'rejected').length;
      this.logger.log(
        `Persistent connections: ${connected} connected, ${failed} failed out of ${connectors.length}`,
      );
    } catch (err) {
      this.logger.error(`Failed to initialize sync schedules: ${(err as Error).message}`);
    }
  }

  /**
   * Add a repeatable sync job for a tenant.
   */
  async addTenantSchedule(tenantId: string, connectorId: string): Promise<void> {
    const jobData: RealtimeSyncJobData = { tenantId, connectorId };

    await this.syncQueue.add('realtime-sync', jobData, {
      repeat: { every: this.syncIntervalMs },
      jobId: `realtime-sync-${tenantId}`,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    });

    this.logger.log(`Scheduled sync for tenant ${tenantId} every ${this.syncIntervalMs / 1000}s`);
  }

  /**
   * Remove a tenant's sync schedule.
   */
  async removeTenantSchedule(tenantId: string): Promise<void> {
    const repeatableJobs = await this.syncQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.id === `realtime-sync-${tenantId}`) {
        await this.syncQueue.removeRepeatableByKey(job.key);
        this.logger.log(`Removed sync schedule for tenant ${tenantId}`);
      }
    }
  }

  /**
   * Pause sync for a tenant. The repeatable job stays but skips execution.
   */
  pauseTenant(tenantId: string): void {
    this.pausedTenants.add(tenantId);
    this.logger.log(`Sync paused for tenant ${tenantId}`);
  }

  /**
   * Resume sync for a tenant.
   */
  resumeTenant(tenantId: string): void {
    this.pausedTenants.delete(tenantId);
    this.logger.log(`Sync resumed for tenant ${tenantId}`);
  }

  /**
   * Check if a tenant's sync is paused.
   */
  isPaused(tenantId: string): boolean {
    return this.pausedTenants.has(tenantId);
  }

  /**
   * Get the configured sync interval in seconds.
   */
  get intervalSeconds(): number {
    return this.syncIntervalMs / 1000;
  }
}

// ─── BullMQ Processor ──────────────────────────────────────

@Processor(REALTIME_SYNC_QUEUE, { concurrency: 3 })
export class RealtimeSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(RealtimeSyncProcessor.name);

  constructor(
    private readonly inboundSyncService: InboundSyncService,
    private readonly schedulerService: SyncSchedulerService,
  ) {
    super();
  }

  async process(job: Job<RealtimeSyncJobData>): Promise<unknown> {
    const { tenantId, connectorId } = job.data;

    // Skip if tenant is paused
    if (this.schedulerService.isPaused(tenantId)) {
      this.logger.debug(`Skipping sync for paused tenant ${tenantId}`);
      return { skipped: true, reason: 'paused' };
    }

    this.logger.log(`Real-time sync triggered: tenant=${tenantId}, connector=${connectorId}`);

    try {
      const result = await this.inboundSyncService.syncIncremental(tenantId, connectorId);
      this.logger.log(
        `Real-time sync complete: tenant=${tenantId}, synced=${result.processedRecords}, duration=${result.durationMs}ms`,
      );
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Real-time sync failed: tenant=${tenantId}: ${msg.substring(0, 500)}`);
      throw error;
    }
  }
}
