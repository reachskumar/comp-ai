import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { AnomalyDetectorService } from './services/anomaly-detector.service';
import { TraceabilityService } from './services/traceability.service';

@Module({
  controllers: [PayrollController],
  providers: [AnomalyDetectorService, TraceabilityService],
  exports: [AnomalyDetectorService, TraceabilityService],
})
export class PayrollModule {}

