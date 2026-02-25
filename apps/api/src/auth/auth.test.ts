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

describe('Auth Module — POST /api/v1/auth/login', () => {
  it('should login with valid seeded admin credentials', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@acme.com', password: 'Admin123!@#' })
      .expect(201);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toMatchObject({
      email: 'admin@acme.com',
      role: 'ADMIN',
    });
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
  });

  it('should reject login with wrong password', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@acme.com', password: 'WrongPassword1!' })
      .expect(401);

    expect(res.body.message).toBe('Invalid credentials');
  });

  it('should reject login with non-existent email', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@acme.com', password: 'Admin123!@#' })
      .expect(401);

    expect(res.body.message).toBe('Invalid credentials');
  });

  it('should reject login with missing fields', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@acme.com' })
      .expect(400);
  });
});

describe('Auth Module — POST /api/v1/auth/register', () => {
  const uniqueEmail = `test-${Date.now()}@vitest.com`;

  it('should register a new user and tenant', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: uniqueEmail,
        password: 'StrongPass1!xy',
        name: 'Test User',
        tenantName: 'Test Tenant',
      })
      .expect(201);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user.email).toBe(uniqueEmail);
    expect(res.body.tenant.name).toBe('Test Tenant');
  });

  it('should reject duplicate email registration', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: uniqueEmail,
        password: 'StrongPass1!xy',
        name: 'Test User 2',
        tenantName: 'Test Tenant 2',
      })
      .expect(409);

    expect(res.body.message).toBe('User with this email already exists');
  });

  it('should reject weak password (too short)', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: `short-${Date.now()}@vitest.com`,
        password: 'Short1!',
        name: 'Test',
        tenantName: 'Tenant',
      })
      .expect(400);
  });
});

describe('Auth Module — POST /api/v1/auth/refresh', () => {
  it('should refresh tokens with a valid refresh token', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    // First login to get tokens
    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@acme.com', password: 'Admin123!@#' })
      .expect(201);

    const res = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(201);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
  });

  it('should reject invalid refresh token', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid-token' })
      .expect(401);
  });
});

describe('Auth Module — GET /api/v1/auth/me', () => {
  it('should return current user info with valid token', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    // Login first
    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@acme.com', password: 'Admin123!@#' })
      .expect(201);

    const res = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      email: 'admin@acme.com',
      role: 'ADMIN',
    });
    expect(res.body).toHaveProperty('userId');
    expect(res.body).toHaveProperty('tenantId');
  });

  it('should reject request without token', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    await request(server)
      .get('/api/v1/auth/me')
      .expect(401);
  });

  it('should reject request with invalid token', async () => {
    const supertest = await import('supertest');
    const request = supertest.default ?? supertest;

    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid-jwt-token')
      .expect(401);
  });
});

