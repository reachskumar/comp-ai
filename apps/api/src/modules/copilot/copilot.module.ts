import { Module } from '@nestjs/common';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { DataScopeService } from '../../common';

@Module({
  controllers: [CopilotController],
  providers: [CopilotService, DataScopeService],
  exports: [CopilotService],
})
export class CopilotModule {}
