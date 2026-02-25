import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database';
import Redis from 'ioredis';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly db: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  async check() {
    const [dbHealthy, redisHealthy] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const status = dbHealthy && redisHealthy ? 'ok' : 'degraded';
    const compportMode = this.configService.get<string>('COMPPORT_MODE') ?? 'standalone';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      services: {
        database: dbHealthy ? 'connected' : 'disconnected',
        redis: redisHealthy ? 'connected' : 'disconnected',
        compportBridge: {
          mode: compportMode,
          loaded: true,
        },
      },
    };
  }

  /**
   * Deep health check — actively tests DB (SELECT 1) and Redis (PING).
   * Returns a flat response suitable for load balancer probes.
   */
  async deepCheck() {
    const [dbHealthy, redisHealthy] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const status = dbHealthy && redisHealthy ? 'ok' : 'degraded';

    return {
      status,
      db: dbHealthy ? 'connected' : 'disconnected',
      redis: redisHealthy ? 'connected' : 'disconnected',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: process.env['npm_package_version'] ?? '1.0.0',
    };
  }

  private async checkDatabase(): Promise<boolean> {
    return this.db.isHealthy();
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const redisUrl = this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
      const redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 3000 });
      await redis.connect();
      await redis.ping();
      await redis.quit();
      return true;
    } catch {
      this.logger.warn('Redis health check failed');
      return false;
    }
  }
}

