import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: Redis;
  private readonly defaultTtl: number;

  constructor(configService: ConfigService) {
    const redisUrl = configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const redisTls = configService.get<string>('REDIS_TLS') === 'true';
    this.defaultTtl = parseInt(configService.get<string>('CACHE_TTL_SECONDS') ?? '300', 10);

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      keyPrefix: 'cache:',
      ...(redisTls ? { tls: { rejectUnauthorized: false } } : {}),
    });

    this.client.connect().catch((err) => {
      this.logger.warn(`Redis cache client failed to connect: ${(err as Error).message}`);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const ttl = ttlSeconds ?? this.defaultTtl;
      await this.client.set(key, JSON.stringify(value), 'EX', ttl);
    } catch {
      this.logger.warn(`Failed to set cache key: ${key}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      this.logger.warn(`Failed to delete cache key: ${key}`);
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(`cache:${pattern}`);
      if (keys.length > 0) {
        // Remove the keyPrefix since the keys already include it
        const unprefixed = keys.map((k) => k.replace(/^cache:/, ''));
        await this.client.del(...unprefixed);
      }
    } catch {
      this.logger.warn(`Failed to delete cache keys matching: ${pattern}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
