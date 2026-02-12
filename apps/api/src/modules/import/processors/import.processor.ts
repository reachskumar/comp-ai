import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImportService } from '../import.service';

interface AnalyzeJobData {
  importJobId: string;
}

interface CleanJobData {
  importJobId: string;
}

@Processor('import-processing')
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(private readonly importService: ImportService) {
    super();
  }

  async process(job: Job<AnalyzeJobData | CleanJobData>): Promise<unknown> {
    this.logger.log(`Processing import job ${job.name} (${job.id}): ${JSON.stringify(job.data)}`);

    try {
      switch (job.name) {
        case 'analyze':
          return await this.handleAnalyze(job as Job<AnalyzeJobData>);
        case 'clean':
          return await this.handleClean(job as Job<CleanJobData>);
        default:
          this.logger.warn(`Unknown job type: ${job.name}`);
          return { success: false, error: `Unknown job type: ${job.name}` };
      }
    } catch (error) {
      this.logger.error(`Failed to process job ${job.id}`, error);
      throw error;
    }
  }

  private async handleAnalyze(job: Job<AnalyzeJobData>) {
    const { importJobId } = job.data;

    // We need the tenantId — fetch the job record
    const importJob = await this.getImportJob(importJobId);
    const analysis = await this.importService.runAnalysis(importJobId, importJob.tenantId);

    this.logger.log(`Analysis complete for job ${importJobId}: ${analysis.summary.totalIssues} issues found`);
    return { success: true, issues: analysis.summary.totalIssues };
  }

  private async handleClean(job: Job<CleanJobData>) {
    const { importJobId } = job.data;

    const importJob = await this.getImportJob(importJobId);
    const result = await this.importService.clean(importJobId, importJob.tenantId);

    this.logger.log(`Cleaning complete for job ${importJobId}: ${result.cleanedRows} cleaned, ${result.rejectedRows} rejected`);
    return { success: true, ...result };
  }

  /**
   * Helper to get the import job record for tenant context.
   * The processor needs access to DatabaseService indirectly through ImportService,
   * but for the tenantId lookup we access it via a simple method.
   */
  private async getImportJob(importJobId: string) {
    // Access the DB through the service's internal method
    // We use a workaround: the service's getById throws if not found,
    // but we need tenantId before we can call it. So we access DB directly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (this.importService as any).db as { client: { importJob: { findUnique: (args: unknown) => Promise<{ tenantId: string } | null> } } };
    const job = await db.client.importJob.findUnique({
      where: { id: importJobId },
    });
    if (!job) {
      throw new Error(`Import job ${importJobId} not found`);
    }
    return job;
  }
}

