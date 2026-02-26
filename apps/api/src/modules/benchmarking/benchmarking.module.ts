import { Module } from '@nestjs/common';
import { BenchmarkingController } from './benchmarking.controller';
import { BenchmarkingService } from './benchmarking.service';

@Module({
  controllers: [BenchmarkingController],
  providers: [BenchmarkingService],
  exports: [BenchmarkingService],
})
export class BenchmarkingModule {}
