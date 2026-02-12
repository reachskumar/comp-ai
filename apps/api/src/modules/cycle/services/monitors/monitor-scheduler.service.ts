import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { DatabaseService } from '../../../../database';
import { BudgetDriftService } from './budget-drift.service';
import { PolicyViolationService } from './policy-violation.service';
import { OutlierDetectorService } from './outlier-detector.service';
import { ExecSummaryService } from './exec-summary.service';
import type { MonitorRunResult } from './types';

const MONITOR_QUEUE = 'cycle-monitors';
const MONITOR_JOB = 'run-monitors';
const HOURLY_CRON = '0 * * * *'; // Every hour

interface MonitorJobData {
  cycleId: string;
  tenantId: string;
  manual?: boolean;
}

@Injectable()
export class MonitorSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(MonitorSchedulerService.name);

  constructor(
    @InjectQueue(MONITOR_QUEUE) private readonly monitorQueue: Queue,
    private readonly db: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Set up repeatable job to check for active cycles every hour
    await this.monitorQueue.add(
      'check-active-cycles',
      {},
      {
        repeat: { pattern: HOURLY_CRON },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log('Monitor scheduler initialized with hourly repeatable job');
  }

  /**
   * Manually trigger monitors for a specific cycle.
   */
  async triggerManualRun(tenantId: string, cycleId: string): Promise<{ jobId: string }> {
    const job = await this.monitorQueue.add(
      MONITOR_JOB,
      { cycleId, tenantId, manual: true } satisfies MonitorJobData,
      {
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log(`Manual monitor run triggered for cycle ${cycleId} (job: ${job.id})`);
    return { jobId: job.id ?? 'unknown' };
  }
}

@Processor(MONITOR_QUEUE)
export class MonitorProcessor extends WorkerHost {
  private readonly logger = new Logger(MonitorProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly budgetDrift: BudgetDriftService,
    private readonly policyViolation: PolicyViolationService,
    private readonly outlierDetector: OutlierDetectorService,
    private readonly execSummary: ExecSummaryService,
  ) {
    super();
  }

  async process(job: Job<MonitorJobData | Record<string, never>>): Promise<unknown> {
    this.logger.log(`Processing monitor job ${job.name} (${job.id})`);

    try {
      switch (job.name) {
        case 'check-active-cycles':
          return await this.handleCheckActiveCycles();
        case MONITOR_JOB:
          return await this.handleRunMonitors(job as Job<MonitorJobData>);
        default:
          this.logger.warn(`Unknown job type: ${job.name}`);
          return { success: false, error: `Unknown job type: ${job.name}` };
      }
    } catch (error) {
      this.logger.error(`Failed to process monitor job ${job.id}`, error);
      throw error;
    }
  }

  /**
   * Find all active cycles and enqueue monitor runs for each.
   */
  private async handleCheckActiveCycles(): Promise<{ cyclesFound: number }> {
    const activeCycles = await this.db.client.compCycle.findMany({
      where: {
        status: { in: ['ACTIVE', 'CALIBRATION', 'APPROVAL'] },
      },
      select: { id: true, tenantId: true },
    });

    this.logger.log(`Found ${activeCycles.length} active cycle(s) to monitor`);

    // Get the queue from the worker's connection
    const queue = new Queue(MONITOR_QUEUE, {
      connection: this.worker.opts.connection as never,
    });

    try {
      for (const cycle of activeCycles) {
        await queue.add(
          MONITOR_JOB,
          { cycleId: cycle.id, tenantId: cycle.tenantId } satisfies MonitorJobData,
          { removeOnComplete: 100, removeOnFail: 50 },
        );
      }
    } finally {
      await queue.close();
    }

    return { cyclesFound: activeCycles.length };
  }

  /**
   * Run all monitors for a specific cycle.
   */
  private async handleRunMonitors(
    job: Job<MonitorJobData>,
  ): Promise<MonitorRunResult> {
    const { cycleId, tenantId } = job.data;

    this.logger.log(`Running monitors for cycle ${cycleId}`);

    // Run all detectors
    const [budgetResult, violationResult, outlierResult] = await Promise.all([
      this.budgetDrift.detect(tenantId, cycleId),
      this.policyViolation.detect(tenantId, cycleId),
      this.outlierDetector.detect(tenantId, cycleId),
    ]);

    // Create alerts for findings
    const alertResults = await Promise.all([
      this.budgetDrift.createAlerts(tenantId, cycleId, budgetResult),
      this.policyViolation.createAlerts(tenantId, cycleId, violationResult),
      this.outlierDetector.createAlerts(tenantId, cycleId, outlierResult),
    ]);

    const totalAlerts = alertResults.reduce((sum, a) => sum + a.length, 0);

    // Store run result in cycle settings
    await this.storeRunResult(cycleId, {
      cycleId,
      runAt: new Date().toISOString(),
      budgetDrift: budgetResult,
      policyViolations: violationResult,
      outliers: outlierResult,
      alertsCreated: totalAlerts,
    });

    this.logger.log(
      `Monitor run complete for cycle ${cycleId}: ${totalAlerts} alert(s) created`,
    );

    return {
      cycleId,
      runAt: new Date().toISOString(),
      budgetDrift: budgetResult,
      policyViolations: violationResult,
      outliers: outlierResult,
      alertsCreated: totalAlerts,
    };
  }

  /**
   * Store the latest monitor run result in the cycle's settings JSON.
   */
  private async storeRunResult(
    cycleId: string,
    result: MonitorRunResult,
  ): Promise<void> {
    const cycle = await this.db.client.compCycle.findUnique({
      where: { id: cycleId },
      select: { settings: true },
    });

    const settings = (typeof cycle?.settings === 'object' && cycle.settings !== null
      ? cycle.settings as Record<string, unknown>
      : {}) as Record<string, unknown>;

    // Keep last 10 monitor runs
    const monitorHistory = Array.isArray(settings['monitorHistory'])
      ? (settings['monitorHistory'] as MonitorRunResult[]).slice(-9)
      : [];
    monitorHistory.push(result);

    await this.db.client.compCycle.update({
      where: { id: cycleId },
      data: {
        settings: {
          ...settings,
          lastMonitorRun: result,
          monitorHistory,
        } as never,
      },
    });
  }
}

