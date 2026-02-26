import { Module } from '@nestjs/common';
import { JobArchitectureController } from './job-architecture.controller';
import { JobArchitectureService } from './job-architecture.service';

@Module({
  controllers: [JobArchitectureController],
  providers: [JobArchitectureService],
  exports: [JobArchitectureService],
})
export class JobArchitectureModule {}
