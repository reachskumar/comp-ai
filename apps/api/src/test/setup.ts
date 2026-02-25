/**
 * Test setup helpers for NestJS API integration tests.
 *
 * Creates a real NestJS application with Fastify adapter,
 * connected to the real test database.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../app.module';

let app: NestFastifyApplication;
let module: TestingModule;

/**
 * Create and initialize the NestJS test application.
 * Reuses the full AppModule so all real providers/guards are active.
 */
export async function createTestApp(): Promise<NestFastifyApplication> {
  module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );

  // Match production config from main.ts
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'api-docs', 'api-docs-json'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}

/**
 * Close the test application and clean up resources.
 */
export async function closeTestApp(): Promise<void> {
  if (app) {
    await app.close();
  }
}

/**
 * Get the underlying Fastify server for supertest.
 */
export function getHttpServer() {
  return app.getHttpServer();
}

/**
 * Helper: login with the seeded admin user and return tokens.
 */
export async function loginAsAdmin(
  server: ReturnType<typeof getHttpServer>,
): Promise<{ accessToken: string; refreshToken: string }> {
  // Use dynamic import for supertest since it's ESM
  const supertest = await import('supertest');
  const request = supertest.default ?? supertest;

  const res = await request(server)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@acme.com', password: 'Admin123!@#' })
    .expect(201);

  return {
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}

