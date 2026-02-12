import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { TotalRewardsService } from './total-rewards.service';

@Module({
  controllers: [AnalyticsController],
  providers: [TotalRewardsService],
  exports: [TotalRewardsService],
})
export class AnalyticsModule {}

