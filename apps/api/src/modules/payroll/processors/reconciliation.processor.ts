import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ReconciliationService } from '../services/reconciliation.service';

interface ReconcileJobData {
  payrollRunId: string;
  tenantId: string;
}

@Processor('payroll-reconciliation')
export class ReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(private readonly reconciliationService: ReconciliationService) {
    super();
  }

  async process(job: Job<ReconcileJobData>): Promise<unknown> {
    const { payrollRunId, tenantId } = job.data;
    this.logger.log(`Processing reconciliation job for run ${payrollRunId}`);

    try {
      const result = await this.reconciliationService.executeReconciliation(
        payrollRunId,
        tenantId,
      );
      this.logger.log(
        `Reconciliation complete for run ${payrollRunId}: ${result.anomalyReport.totalAnomalies} anomalies`,
      );
      return { success: true, anomalies: result.anomalyReport.totalAnomalies };
    } catch (error) {
      this.logger.error(`Reconciliation failed for run ${payrollRunId}`, error);
      throw error;
    }
  }
}

