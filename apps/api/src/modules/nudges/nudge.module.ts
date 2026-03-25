import { Module } from '@nestjs/common';
import { NudgeController } from './nudge.controller';
import { NudgeService } from './nudge.service';

@Module({
  controllers: [NudgeController],
  providers: [NudgeService],
  exports: [NudgeService],
})
export class NudgeModule {}
