import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { TotalRewardsService } from './total-rewards.service';
import { PayEquityService } from './pay-equity.service';
import { SimulationService } from './simulation.service';

@Module({
  controllers: [AnalyticsController],
  providers: [TotalRewardsService, PayEquityService, SimulationService],
  exports: [TotalRewardsService, PayEquityService, SimulationService],
})
export class AnalyticsModule {}

