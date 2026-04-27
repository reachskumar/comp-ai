import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LettersService } from './letters.service';
import type { GenerateBatchLetterDto } from './dto/generate-batch-letter.dto';

export interface LettersBatchJobData {
  tenantId: string;
  userId: string;
  batchId: string;
  dto: GenerateBatchLetterDto;
}

export interface LettersBatchJobResult {
  batchId: string;
  total: number;
  succeeded: number;
  failed: number;
}

@Processor('letters-batch')
export class LettersBatchProcessor extends WorkerHost {
  private readonly logger = new Logger(LettersBatchProcessor.name);

  constructor(private readonly lettersService: LettersService) {
    super();
  }

  async process(job: Job<LettersBatchJobData>): Promise<LettersBatchJobResult> {
    const { tenantId, userId, batchId, dto } = job.data;
    this.logger.log(
      `Batch ${batchId} starting: ${dto.employeeIds.length} employees, tenant=${tenantId}`,
    );

    const result = await this.lettersService.runBatchJob({
      tenantId,
      userId,
      batchId,
      dto,
      onProgress: (done, total) => {
        void job.updateProgress(Math.round((done / total) * 100));
      },
    });

    this.logger.log(
      `Batch ${batchId} done: ${result.succeeded}/${result.total} succeeded, ${result.failed} failed`,
    );
    return result;
  }
}
