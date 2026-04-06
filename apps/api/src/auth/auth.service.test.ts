import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import {
  createMockDatabaseService,
  createMockConfigService,
  getJwtService,
  TEST_ADMIN,
  TEST_TENANT_ID,
  TEST_USER_ID,
  TEST_JWT_SECRET,
  generateTestToken,
} from '../test/setup';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createAuthService(configOverrides: Record<string, unknown> = {}) {
  const db = createMockDatabaseService();
  const jwtService = getJwtService();
  const configService = createMockConfigService(configOverrides);

  const service = new (AuthService as any)(db, jwtService, configService) as AuthService;
  return { service, db, jwtService, configService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  // ─── register ─────────────────────────────────────────────

  describe('register', () => {
    let service: AuthService;
    let db: ReturnType<typeof createMockDatabaseService>;

    beforeEach(() => {
      ({ service, db } = createAuthService());
      db.client.refreshToken.create.mockResolvedValue({});
      db.client.userSession.create.mockResolvedValue({});
    });

    it('should register a new user and tenant, returning tokens', async () => {
      db.client.user.findFirst.mockResolvedValue(null);
      db.client.tenant.create.mockResolvedValue({
        id: 'tenant-new',
        name: 'Acme Inc',
        slug: 'acme-inc-1700000000000',
        users: [
          {
            id: 'user-new',
            email: 'founder@acme.com',
            name: 'Founder',
            role: 'ADMIN',
            tenantId: 'tenant-new',
          },
        ],
      });

      const result = await service.register({
        email: 'founder@acme.com',
        password: 'SecurePass123!@',
        name: 'Founder',
        tenantName: 'Acme Inc',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user).toMatchObject({
        id: 'user-new',
        email: 'founder@acme.com',
        name: 'Founder',
        role: 'ADMIN',
      });
      expect(result.tenant).toMatchObject({
        id: 'tenant-new',
        name: 'Acme Inc',
      });
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('should hash the password with bcrypt (12 rounds)', async () => {
      db.client.user.findFirst.mockResolvedValue(null);
      db.client.tenant.create.mockResolvedValue({
        id: 'tenant-new',
        name: 'Test',
        slug: 'test-123',
        users: [
          {
            id: 'user-new',
            email: 'test@test.com',
            name: 'Test',
            role: 'ADMIN',
            tenantId: 'tenant-new',
          },
        ],
      });

      await service.register({
        email: 'test@test.com',
        password: 'MyPassword123!@',
        name: 'Test',
        tenantName: 'Test',
      });

      // Verify tenant.create was called with a hashed password
      const createCall = db.client.tenant.create.mock.calls[0][0];
      const passwordHash = createCall.data.users.create.passwordHash;

      // bcrypt hashes start with $2b$12$ (12 rounds)
      expect(passwordHash).toMatch(/^\$2[aby]\$12\$/);
      // The hash should NOT be the plain text password
      expect(passwordHash).not.toBe('MyPassword123!@');
    });

    it('should generate a slug from the tenant name', async () => {
      db.client.user.findFirst.mockResolvedValue(null);
      db.client.tenant.create.mockImplementation(async (args: any) => ({
        id: 'tenant-new',
        name: args.data.name,
        slug: args.data.slug,
        users: [
          {
            id: 'user-new',
            email: 'test@test.com',
            name: 'Test',
            role: 'ADMIN',
            tenantId: 'tenant-new',
          },
        ],
      }));

      await service.register({
        email: 'test@test.com',
        password: 'MyPassword123!@',
        name: 'Test',
        tenantName: 'My Cool Company!!',
      });

      const createCall = db.client.tenant.create.mock.calls[0][0];
      const slug = createCall.data.slug;
      // Should be lowercase, hyphenated, with timestamp suffix
      expect(slug).toMatch(/^my-cool-company-\d+$/);
    });

    it('should throw ConflictException for duplicate email', async () => {
      db.client.user.findFirst.mockResolvedValue(TEST_ADMIN);

      await expect(
        service.register({
          email: 'admin@acme.com',
          password: 'StrongPass123!@',
          name: 'Dup',
          tenantName: 'Dup Tenant',
        }),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.register({
          email: 'admin@acme.com',
          password: 'StrongPass123!@',
          name: 'Dup',
          tenantName: 'Dup Tenant',
        }),
      ).rejects.toThrow('User with this email already exists');
    });

    it('should check for existing user before creating tenant', async () => {
      db.client.user.findFirst.mockResolvedValue(TEST_ADMIN);

      await expect(
        service.register({
          email: 'admin@acme.com',
          password: 'StrongPass123!@',
          name: 'Test',
          tenantName: 'Test',
        }),
      ).rejects.toThrow(ConflictException);

      // tenant.create should NOT be called if user already exists
      expect(db.client.tenant.create).not.toHaveBeenCalled();
    });
  });

  // ─── login ────────────────────────────────────────────────

  describe('login', () => {
    let service: AuthService;
    let db: ReturnType<typeof createMockDatabaseService>;

    beforeEach(() => {
      ({ service, db } = createAuthService());
      // generateTokens stores refresh token and session
      db.client.refreshToken.create.mockResolvedValue({});
      db.client.userSession.create.mockResolvedValue({});
    });

    it('should return user info and tokens for valid credentials', async () => {
      db.client.user.findFirst.mockResolvedValue(TEST_ADMIN);

      const result = await service.login({
        email: 'admin@acme.com',
        password: 'Admin123!@#',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user).toMatchObject({
        id: TEST_USER_ID,
        email: 'admin@acme.com',
        name: 'Admin User',
        role: 'ADMIN',
      });
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      db.client.user.findFirst.mockResolvedValue(TEST_ADMIN);

      await expect(
        service.login({ email: 'admin@acme.com', password: 'WrongPassword1!' }),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.login({ email: 'admin@acme.com', password: 'WrongPassword1!' }),
      ).rejects.toThrow('Invalid credentials');
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      db.client.user.findFirst.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@acme.com', password: 'SomePass123!@' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user has no passwordHash', async () => {
      db.client.user.findFirst.mockResolvedValue({ ...TEST_ADMIN, passwordHash: null });

      await expect(
        service.login({ email: 'admin@acme.com', password: 'Admin123!@#' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when passwordHash is empty string', async () => {
      db.client.user.findFirst.mockResolvedValue({ ...TEST_ADMIN, passwordHash: '' });

      // Empty string is falsy so the !user.passwordHash check triggers
      await expect(
        service.login({ email: 'admin@acme.com', password: 'Admin123!@#' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should produce JWT tokens that contain correct payload', async () => {
      db.client.user.findFirst.mockResolvedValue(TEST_ADMIN);

      const result = await service.login({
        email: 'admin@acme.com',
        password: 'Admin123!@#',
      });

      // Verify the access token contains the expected claims
      const jwtService = getJwtService();
      const decoded = jwtService.verify(result.accessToken, { secret: TEST_JWT_SECRET });

      expect(decoded.sub).toBe(TEST_USER_ID);
      expect(decoded.tenantId).toBe(TEST_TENANT_ID);
      expect(decoded.email).toBe('admin@acme.com');
      expect(decoded.role).toBe('ADMIN');
    });
  });

  // ─── refresh ──────────────────────────────────────────────

  describe('refresh', () => {
    let service: AuthService;
    let db: ReturnType<typeof createMockDatabaseService>;

    /** Helper: mock a valid stored refresh token */
    function mockStoredToken() {
      db.client.tokenBlacklist.findUnique.mockResolvedValue(null);
      db.client.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: TEST_USER_ID,
        tokenHash: 'mock-hash',
        familyId: 'family-1',
        revoked: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      db.client.refreshToken.update.mockResolvedValue({});
      db.client.refreshToken.create.mockResolvedValue({});
      db.client.userSession.create.mockResolvedValue({});
    }

    beforeEach(() => {
      ({ service, db } = createAuthService());
    });

    it('should return new tokens for a valid refresh token', async () => {
      mockStoredToken();
      db.client.user.findUnique.mockResolvedValue(TEST_ADMIN);
      const validToken = generateTestToken();

      const result = await service.refresh(validToken);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');
    });

    it('should throw UnauthorizedException for invalid/malformed token', async () => {
      await expect(service.refresh('not-a-jwt-token')).rejects.toThrow(UnauthorizedException);
      await expect(service.refresh('not-a-jwt-token')).rejects.toThrow('Invalid refresh token');
    });

    it('should throw UnauthorizedException for token signed with wrong secret', async () => {
      const wrongJwtService = new JwtService({ secret: 'wrong-secret-key' });
      const badToken = wrongJwtService.sign({
        sub: TEST_USER_ID,
        tenantId: TEST_TENANT_ID,
        email: 'admin@acme.com',
        role: 'ADMIN',
      });

      await expect(service.refresh(badToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user not found for valid token', async () => {
      mockStoredToken();
      db.client.user.findUnique.mockResolvedValue(null);
      const validToken = generateTestToken();

      await expect(service.refresh(validToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for expired token', async () => {
      const expiredJwtService = new JwtService({ secret: TEST_JWT_SECRET });
      const expiredToken = expiredJwtService.sign(
        {
          sub: TEST_USER_ID,
          tenantId: TEST_TENANT_ID,
          email: 'admin@acme.com',
          role: 'ADMIN',
        },
        { expiresIn: '-1h' },
      );

      await expect(service.refresh(expiredToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should look up user by sub (userId) from the token payload', async () => {
      mockStoredToken();
      db.client.user.findUnique.mockResolvedValue(TEST_ADMIN);
      const token = generateTestToken({ sub: 'user-specific-id' });

      await service.refresh(token);

      expect(db.client.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-specific-id' },
      });
    });

    it('should generate new access and refresh tokens with user data from DB', async () => {
      const dbUser = {
        ...TEST_ADMIN,
        id: 'user-from-db',
        tenantId: 'tenant-from-db',
        email: 'db-user@acme.com',
        role: 'VIEWER',
      };
      mockStoredToken();
      db.client.user.findUnique.mockResolvedValue(dbUser);
      const token = generateTestToken();

      const result = await service.refresh(token);

      const jwtService = getJwtService();
      const decoded = jwtService.verify(result.accessToken, { secret: TEST_JWT_SECRET });
      expect(decoded.sub).toBe('user-from-db');
      expect(decoded.tenantId).toBe('tenant-from-db');
      expect(decoded.email).toBe('db-user@acme.com');
      expect(decoded.role).toBe('VIEWER');
    });

    it('should return two distinct tokens (access != refresh)', async () => {
      mockStoredToken();
      db.client.user.findUnique.mockResolvedValue(TEST_ADMIN);
      const token = generateTestToken();

      const result = await service.refresh(token);

      expect(result.accessToken).not.toBe(result.refreshToken);
    });
  });
});
