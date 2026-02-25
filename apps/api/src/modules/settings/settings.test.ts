import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createTestApp,
  closeTestApp,
  getHttpServer,
  loginAsAdmin,
} from '../../test/setup';

let app: NestFastifyApplication;
let server: ReturnType<typeof getHttpServer>;

beforeAll(async () => {
  app = await createTestApp();
  server = getHttpServer();
}, 60000);

afterAll(async () => {
  await closeTestApp();
}, 15000);

describe('Settings Module — guarded endpoints', () => {
  it('should reject unauthenticated request to GET /api/v1/settings/tenant', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    await request(server)
      .get('/api/v1/settings/tenant')
      .expect(401);
  });

  it('should return tenant info for authenticated admin', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    const { accessToken } = await loginAsAdmin(server);

    const res = await request(server)
      .get('/api/v1/settings/tenant')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('slug');
  });

  it('should reject unauthenticated request to GET /api/v1/settings/users', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    await request(server)
      .get('/api/v1/settings/users')
      .expect(401);
  });

  it('should return users list for authenticated admin', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    const { accessToken } = await loginAsAdmin(server);

    const res = await request(server)
      .get('/api/v1/settings/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('email');
  });
});

