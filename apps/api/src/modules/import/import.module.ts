import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportProcessor } from './processors/import.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'import-processing' }),
  ],
  controllers: [ImportController],
  providers: [ImportService, ImportProcessor],
  exports: [ImportService],
})
export class ImportModule {}

