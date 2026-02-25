import { describe, it, expect, beforeEach } from 'vitest';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  createMockDatabaseService,
  createMockConfigService,
  getJwtService,
  TEST_ADMIN,
  TEST_TENANT_ID,
  TEST_JWT_SECRET,
  generateTestToken,
} from '../test/setup';

// Directly instantiate AuthService with mocked deps (no NestJS DI needed)
function createAuthService() {
  const db = createMockDatabaseService();
  const jwtService = getJwtService();
  const configService = createMockConfigService();
  // Construct AuthService manually — bypasses NestJS DI
  const service = new (AuthService as any)(db, jwtService, configService);
  return { service: service as AuthService, db, jwtService, configService };
}

describe('AuthService — login', () => {
  let service: AuthService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createAuthService());
  });

  it('should login with valid credentials and return tokens', async () => {
    db.client.user.findFirst.mockResolvedValue(TEST_ADMIN);

    const result = await service.login({ email: 'admin@acme.com', password: 'Admin123!@#' });

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result.user).toMatchObject({ email: 'admin@acme.com', role: 'ADMIN' });
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
  });

  it('should reject login with wrong password', async () => {
    db.client.user.findFirst.mockResolvedValue(TEST_ADMIN);

    await expect(
      service.login({ email: 'admin@acme.com', password: 'WrongPassword1!' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should reject login with non-existent email', async () => {
    db.client.user.findFirst.mockResolvedValue(null);

    await expect(
      service.login({ email: 'nobody@acme.com', password: 'Admin123!@#' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should reject login when user has no passwordHash', async () => {
    db.client.user.findFirst.mockResolvedValue({ ...TEST_ADMIN, passwordHash: null });

    await expect(
      service.login({ email: 'admin@acme.com', password: 'Admin123!@#' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('AuthService — register', () => {
  let service: AuthService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createAuthService());
  });

  it('should register a new user and tenant', async () => {
    db.client.user.findFirst.mockResolvedValue(null);
    db.client.tenant.create.mockResolvedValue({
      id: 'tenant-new',
      name: 'Test Tenant',
      slug: 'test-tenant-123',
      users: [{
        id: 'user-new',
        email: 'new@test.com',
        name: 'New User',
        role: 'ADMIN',
        tenantId: 'tenant-new',
      }],
    });

    const result = await service.register({
      email: 'new@test.com',
      password: 'StrongPass1!xy',
      name: 'New User',
      tenantName: 'Test Tenant',
    });

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result.user.email).toBe('new@test.com');
    expect(result.tenant.name).toBe('Test Tenant');
    expect(db.client.tenant.create).toHaveBeenCalledOnce();
  });

  it('should reject duplicate email registration', async () => {
    db.client.user.findFirst.mockResolvedValue(TEST_ADMIN);

    await expect(
      service.register({
        email: 'admin@acme.com',
        password: 'StrongPass1!xy',
        name: 'Dup User',
        tenantName: 'Dup Tenant',
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('AuthService — refresh', () => {
  let service: AuthService;
  let db: ReturnType<typeof createMockDatabaseService>;

  beforeEach(() => {
    ({ service, db } = createAuthService());
  });

  it('should refresh tokens with a valid refresh token', async () => {
    db.client.user.findUnique.mockResolvedValue(TEST_ADMIN);
    const token = generateTestToken();

    const result = await service.refresh(token);

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });

  it('should reject invalid refresh token', async () => {
    await expect(service.refresh('invalid-token')).rejects.toThrow(UnauthorizedException);
  });

  it('should reject when user not found for valid token', async () => {
    db.client.user.findUnique.mockResolvedValue(null);
    const token = generateTestToken();

    await expect(service.refresh(token)).rejects.toThrow(UnauthorizedException);
  });
});

