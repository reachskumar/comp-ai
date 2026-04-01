import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { TotalRewardsService } from './total-rewards.service';
import { PayEquityService } from './pay-equity.service';
import { SimulationService } from './simulation.service';
import { HrDashboardService } from './hr-dashboard.service';
import { EdgeRegressionService } from './edge-regression.service';
import { BenchmarkingModule } from '../benchmarking/benchmarking.module';
import { DataScopeService } from '../../common';

@Module({
  imports: [BenchmarkingModule],
  controllers: [AnalyticsController],
  providers: [
    TotalRewardsService,
    PayEquityService,
    SimulationService,
    HrDashboardService,
    EdgeRegressionService,
    DataScopeService,
  ],
  exports: [
    TotalRewardsService,
    PayEquityService,
    SimulationService,
    HrDashboardService,
    EdgeRegressionService,
  ],
})
export class AnalyticsModule {}
