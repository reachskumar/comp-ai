import { Module } from '@nestjs/common';
import { EmployeePortalController } from './employee-portal.controller';
import { EmployeePortalService } from './employee-portal.service';

@Module({
  controllers: [EmployeePortalController],
  providers: [EmployeePortalService],
  exports: [EmployeePortalService],
})
export class EmployeePortalModule {}
