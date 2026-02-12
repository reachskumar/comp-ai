import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CycleController } from './cycle.controller';
import { CycleService } from './cycle.service';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './services/approval.service';
import { CalibrationService } from './services/calibration.service';
import { MonitorsController } from './monitors.controller';
import {
  BudgetDriftService,
  PolicyViolationService,
  OutlierDetectorService,
  ExecSummaryService,
  MonitorSchedulerService,
  MonitorProcessor,
} from './services/monitors';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'cycle-processing' }),
    BullModule.registerQueue({ name: 'cycle-monitors' }),
  ],
  controllers: [CycleController, ApprovalController, MonitorsController],
  providers: [
    CycleService,
    ApprovalService,
    CalibrationService,
    BudgetDriftService,
    PolicyViolationService,
    OutlierDetectorService,
    ExecSummaryService,
    MonitorSchedulerService,
    MonitorProcessor,
  ],
  exports: [
    CycleService,
    ApprovalService,
    CalibrationService,
    BudgetDriftService,
    PolicyViolationService,
    OutlierDetectorService,
    ExecSummaryService,
    MonitorSchedulerService,
  ],
})
export class CycleModule {}

