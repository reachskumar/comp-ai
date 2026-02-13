import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { TotalRewardsService } from './total-rewards.service';
import { PayEquityService } from './pay-equity.service';
import { SimulationService } from './simulation.service';
import { HrDashboardService } from './hr-dashboard.service';

@Module({
  controllers: [AnalyticsController],
  providers: [TotalRewardsService, PayEquityService, SimulationService, HrDashboardService],
  exports: [TotalRewardsService, PayEquityService, SimulationService, HrDashboardService],
})
export class AnalyticsModule {}

