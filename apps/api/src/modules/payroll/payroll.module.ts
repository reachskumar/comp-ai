import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PayrollController } from './payroll.controller';
import { AnomalyDetectorService } from './services/anomaly-detector.service';
import { TraceabilityService } from './services/traceability.service';
import { ReconciliationService } from './services/reconciliation.service';
import { ReconciliationProcessor } from './processors/reconciliation.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'payroll-reconciliation' }),
  ],
  controllers: [PayrollController],
  providers: [
    AnomalyDetectorService,
    TraceabilityService,
    ReconciliationService,
    ReconciliationProcessor,
  ],
  exports: [AnomalyDetectorService, TraceabilityService, ReconciliationService],
})
export class PayrollModule {}

