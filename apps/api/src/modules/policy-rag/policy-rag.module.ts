import { Module } from '@nestjs/common';
import { PolicyRagController } from './policy-rag.controller';
import { PolicyRagService } from './policy-rag.service';

@Module({
  controllers: [PolicyRagController],
  providers: [PolicyRagService],
  exports: [PolicyRagService],
})
export class PolicyRagModule {}
