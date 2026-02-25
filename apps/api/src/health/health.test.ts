import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, closeTestApp, getHttpServer } from '../test/setup';

let app: NestFastifyApplication;
let server: ReturnType<typeof getHttpServer>;

beforeAll(async () => {
  app = await createTestApp();
  server = getHttpServer();
}, 60000);

afterAll(async () => {
  await closeTestApp();
}, 15000);

describe('Health Module — GET /health', () => {
  it('should return health status', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    const res = await request(server)
      .get('/health')
      .expect(200);

    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('services');
    expect(res.body.services).toHaveProperty('database');
    expect(res.body.services).toHaveProperty('redis');
    expect(['ok', 'degraded']).toContain(res.body.status);
  });

  it('should report database as connected', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    const res = await request(server)
      .get('/health')
      .expect(200);

    expect(res.body.services.database).toBe('connected');
  });

  it('should not require authentication', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    // Health endpoint should work without any auth header
    await request(server)
      .get('/health')
      .expect(200);
  });
});

