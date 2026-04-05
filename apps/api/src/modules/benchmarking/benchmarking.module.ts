import { Module } from '@nestjs/common';
import { BenchmarkingController } from './benchmarking.controller';
import { BenchmarkingService } from './benchmarking.service';
import { MarketDataSyncService } from './market-data-sync.service';

@Module({
  controllers: [BenchmarkingController],
  providers: [BenchmarkingService, MarketDataSyncService],
  exports: [BenchmarkingService, MarketDataSyncService],
})
export class BenchmarkingModule {}
