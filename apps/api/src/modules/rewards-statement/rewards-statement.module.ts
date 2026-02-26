import { Module } from '@nestjs/common';
import { RewardsStatementController } from './rewards-statement.controller';
import { RewardsStatementService } from './rewards-statement.service';

@Module({
  controllers: [RewardsStatementController],
  providers: [RewardsStatementService],
  exports: [RewardsStatementService],
})
export class RewardsStatementModule {}
