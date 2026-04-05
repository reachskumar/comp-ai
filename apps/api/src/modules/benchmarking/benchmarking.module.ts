import { Module } from '@nestjs/common';
import { BenchmarkingController } from './benchmarking.controller';
import { BenchmarkingService } from './benchmarking.service';
import { MarketDataImportService } from './services/market-data-import.service';
import { MarketDataAgeingService } from './services/market-data-ageing.service';
import { MarketDataSyncService } from './market-data-sync.service';

@Module({
  controllers: [BenchmarkingController],
  providers: [BenchmarkingService, MarketDataImportService, MarketDataAgeingService, MarketDataSyncService],
  exports: [BenchmarkingService, MarketDataImportService, MarketDataAgeingService, MarketDataSyncService],
})
export class BenchmarkingModule {}
