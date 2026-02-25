/**
 * Test setup helpers for NestJS API unit tests.
 *
 * Uses direct instantiation with mocked dependencies — no NestJS DI container.
 * This avoids the esbuild/emitDecoratorMetadata issue with Vitest.
 */
import { JwtService } from '@nestjs/jwt';

// ─── Test Constants ──────────────────────────────────────────────────────────

export const TEST_JWT_SECRET = 'test-jwt-secret-for-vitest-only';
export const TEST_TENANT_ID = 'tenant-test-001';
export const TEST_USER_ID = 'user-test-001';
export const TEST_ADMIN = {
  id: TEST_USER_ID,
  email: 'admin@acme.com',
  name: 'Admin User',
  role: 'ADMIN',
  tenantId: TEST_TENANT_ID,
  passwordHash: '$2b$12$NeRqfnJgr9/MsR9szoyhQu1JreFPpNxIEeudY8jHC8kFlars7wqhK', // bcrypt of Admin123!@#
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
export const TEST_TENANT = {
  id: TEST_TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme-corp',
  plan: 'enterprise',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Mock Prisma Client ──────────────────────────────────────────────────────

export function createMockPrismaClient() {
  const createModelMock = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    upsert: vi.fn(),
  });
  return {
    user: createModelMock(),
    tenant: createModelMock(),
    employee: createModelMock(),
    compCycle: createModelMock(),
    cycleBudget: createModelMock(),
    compRecommendation: createModelMock(),
    calibrationSession: createModelMock(),
    auditLog: createModelMock(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  };
}

// ─── Mock DatabaseService ────────────────────────────────────────────────────

export function createMockDatabaseService() {
  const mockClient = createMockPrismaClient();
  return {
    client: mockClient,
    onModuleInit: vi.fn(),
    onModuleDestroy: vi.fn(),
    isHealthy: vi.fn().mockResolvedValue(true),
  };
}

// ─── Mock ConfigService ──────────────────────────────────────────────────────

export function createMockConfigService(overrides: Record<string, unknown> = {}) {
  const config: Record<string, unknown> = {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: TEST_JWT_SECRET,
    REDIS_URL: 'redis://localhost:6379',
    NODE_ENV: 'test',
    COMPPORT_MODE: 'standalone',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => config[key]),
    getOrThrow: vi.fn((key: string) => {
      if (!(key in config)) throw new Error(`Missing config: ${key}`);
      return config[key];
    }),
  };
}

// ─── Real JwtService (standalone, no DI needed) ─────────────────────────────

const _jwtService = new JwtService({
  secret: TEST_JWT_SECRET,
  signOptions: { expiresIn: '15m' },
});

export function getJwtService(): JwtService {
  return _jwtService;
}

// ─── Token Helpers ───────────────────────────────────────────────────────────

export function generateTestToken(
  overrides: Partial<{ sub: string; tenantId: string; email: string; role: string }> = {},
): string {
  return _jwtService.sign({
    sub: overrides.sub ?? TEST_USER_ID,
    tenantId: overrides.tenantId ?? TEST_TENANT_ID,
    email: overrides.email ?? TEST_ADMIN.email,
    role: overrides.role ?? TEST_ADMIN.role,
  });
}

// ─── Type Exports ────────────────────────────────────────────────────────────

export type MockDatabaseService = ReturnType<typeof createMockDatabaseService>;
export type MockConfigService = ReturnType<typeof createMockConfigService>;

