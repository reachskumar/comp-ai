import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { RedisCacheService } from '../common/services/redis-cache.service';
import { MetricsService } from '../common/services/metrics.service';

@Global()
@Module({
  providers: [DatabaseService, RedisCacheService, MetricsService],
  exports: [DatabaseService, RedisCacheService, MetricsService],
})
export class DatabaseModule {}

