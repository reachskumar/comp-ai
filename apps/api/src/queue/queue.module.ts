import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { TestQueueProcessor } from './test-queue.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        const url = new URL(redisUrl);
        const redisTls = configService.get<string>('REDIS_TLS') === 'true';
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port || '6379', 10),
            ...(redisTls ? { tls: { rejectUnauthorized: false } } : {}),
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 86400 },   // Keep completed jobs for 24h
            removeOnFail: { age: 604800 },       // Keep failed jobs for 7 days
          },
        };
      },
    }),
    BullModule.registerQueue({ name: 'test-queue' }),
  ],
  providers: [TestQueueProcessor],
  exports: [BullModule],
})
export class QueueModule implements OnModuleInit {
  private readonly logger = new Logger(QueueModule.name);

  constructor(@InjectQueue('test-queue') private readonly testQueue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.testQueue.add('startup-test', { message: 'API started', timestamp: new Date().toISOString() });
      this.logger.log('Test job added to test-queue successfully');
    } catch (error) {
      this.logger.error('Failed to add test job to queue', error);
    }
  }
}

