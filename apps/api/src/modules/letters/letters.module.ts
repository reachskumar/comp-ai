import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LettersController } from './letters.controller';
import { LetterAcknowledgeController } from './letter-acknowledge.controller';
import { LettersService } from './letters.service';
import { LettersBatchProcessor } from './letters-batch.processor';
import { LetterEmailService } from './email.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'letters-batch' })],
  // Important: LetterAcknowledgeController is registered first so the
  // /letters/acknowledge route resolves before the parameterized /letters/:id
  // routes on LettersController. Both are protected differently — the acks
  // endpoint is public; the rest requires JWT/Tenant/Permission guards.
  controllers: [LetterAcknowledgeController, LettersController],
  providers: [LettersService, LettersBatchProcessor, LetterEmailService],
  exports: [LettersService, LetterEmailService],
})
export class LettersModule {}
