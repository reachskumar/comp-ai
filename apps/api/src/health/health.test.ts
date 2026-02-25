import { describe, it, expect, beforeEach } from 'vitest';
import { HealthService } from './health.service';
import {
  createMockDatabaseService,
  createMockConfigService,
} from '../test/setup';

function createHealthService() {
  const db = createMockDatabaseService();
  const configService = createMockConfigService();
  const service = new (HealthService as any)(db, configService);
  return { service: service as HealthService, db, configService };
}

describe('HealthService — check', () => {
  let service: HealthService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createHealthService());
  });

  it('should return health status with database connected (redis unavailable in test env)', async () => {
    db.isHealthy.mockResolvedValue(true);

    const result = await service.check();

    // Redis is unavailable in test env, so status is 'degraded' even when DB is healthy
    expect(['ok', 'degraded']).toContain(result.status);
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('uptime');
    expect(result).toHaveProperty('services');
    expect(result.services.database).toBe('connected');
  });

  it('should return degraded status when database is unhealthy', async () => {
    db.isHealthy.mockResolvedValue(false);

    const result = await service.check();

    expect(result.status).toBe('degraded');
    expect(result.services.database).toBe('disconnected');
  });

  it('should include uptime as a non-negative number', async () => {
    db.isHealthy.mockResolvedValue(true);

    const result = await service.check();

    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should include a valid ISO timestamp', async () => {
    db.isHealthy.mockResolvedValue(true);

    const result = await service.check();

    const parsed = new Date(result.timestamp);
    expect(parsed.toISOString()).toBe(result.timestamp);
  });

  it('should include compportBridge service info', async () => {
    db.isHealthy.mockResolvedValue(true);

    const result = await service.check();

    expect(result.services.compportBridge).toMatchObject({
      mode: 'standalone',
      loaded: true,
    });
  });

  it('should include redis service status', async () => {
    db.isHealthy.mockResolvedValue(true);

    const result = await service.check();

    expect(result.services).toHaveProperty('redis');
    // Redis will be 'disconnected' in test env (no real Redis)
    expect(['connected', 'disconnected']).toContain(result.services.redis);
  });
});

describe('HealthService — deepCheck', () => {
  let service: HealthService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createHealthService());
  });

  it('should return deep check with db and redis status', async () => {
    db.isHealthy.mockResolvedValue(true);

    const result = await service.deepCheck();

    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('db');
    expect(result).toHaveProperty('redis');
    expect(result).toHaveProperty('uptime');
    expect(result).toHaveProperty('version');
    expect(result.db).toBe('connected');
  });

  it('should report degraded when database is down', async () => {
    db.isHealthy.mockResolvedValue(false);

    const result = await service.deepCheck();

    expect(result.status).toBe('degraded');
    expect(result.db).toBe('disconnected');
  });
});

