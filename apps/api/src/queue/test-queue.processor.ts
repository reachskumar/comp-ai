import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('test-queue')
export class TestQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(TestQueueProcessor.name);

  async process(job: Job): Promise<{ success: boolean }> {
    this.logger.log(`Processing job ${job.id} with data: ${JSON.stringify(job.data)}`);
    return { success: true };
  }
}

