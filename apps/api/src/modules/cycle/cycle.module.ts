import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CycleController } from './cycle.controller';
import { CycleService } from './cycle.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'cycle-processing' }),
  ],
  controllers: [CycleController],
  providers: [CycleService],
  exports: [CycleService],
})
export class CycleModule {}

