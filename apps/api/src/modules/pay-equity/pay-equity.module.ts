import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AnalyticsModule } from '../analytics/analytics.module';
import { LettersModule } from '../letters/letters.module';
import { PayEquityController } from './pay-equity.controller';
import { PayEquityV2Service } from './pay-equity.service';
import { PEDistributionService } from './pe-distribution.service';
import { PEDistributionProcessor, PE_DISTRIBUTION_QUEUE } from './pe-distribution.processor';
import { PEShareController } from './pe-share.controller';

/**
 * Pay Equity (v2) — auditor-defensible workspace.
 *
 * Imports AnalyticsModule to share the existing PayEquityService statistical
 * engine, LettersModule to reuse LetterEmailService for distribution
 * (Phase 3.7 + 6.4 scheduled delivery, 5.5 share-token portal), and
 * registers a BullMQ queue for the hourly distribution cron.
 */
@Module({
  imports: [
    AnalyticsModule,
    LettersModule,
    BullModule.registerQueue({ name: PE_DISTRIBUTION_QUEUE }),
  ],
  controllers: [PayEquityController, PEShareController],
  providers: [PayEquityV2Service, PEDistributionService, PEDistributionProcessor],
  exports: [PayEquityV2Service, PEDistributionService],
})
export class PayEquityModule {}
