import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LettersController } from './letters.controller';
import { LettersService } from './letters.service';
import { LettersBatchProcessor } from './letters-batch.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'letters-batch' })],
  controllers: [LettersController],
  providers: [LettersService, LettersBatchProcessor],
  exports: [LettersService],
})
export class LettersModule {}
