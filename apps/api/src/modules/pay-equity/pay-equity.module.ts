import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PayEquityController } from './pay-equity.controller';
import { PayEquityV2Service } from './pay-equity.service';

/**
 * Pay Equity (v2) — auditor-defensible workspace.
 *
 * Imports AnalyticsModule to share the existing PayEquityService statistical
 * engine. The legacy /analytics/pay-equity/* endpoints stay untouched; this
 * module's /pay-equity/* endpoints are the new contract.
 */
@Module({
  imports: [AnalyticsModule],
  controllers: [PayEquityController],
  providers: [PayEquityV2Service],
  exports: [PayEquityV2Service],
})
export class PayEquityModule {}
