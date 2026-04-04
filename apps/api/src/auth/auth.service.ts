import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { DatabaseService } from '../database';
import { RegisterDto, LoginDto } from './dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    // Bypass RLS for pre-auth email check
    const existingUsers = await this.db.client.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      dto.email,
    );

    if (existingUsers.length > 0) {
      throw new ConflictException('User with this email already exists');
    }

    const slug = dto.tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const tenant = await this.db.client.tenant.create({
      data: {
        name: dto.tenantName,
        slug: `${slug}-${Date.now()}`,
        users: {
          create: {
            email: dto.email,
            name: dto.name,
            passwordHash,
            role: 'ADMIN',
          },
        },
      },
      include: { users: true },
    });

    const user = tenant.users[0]!;
    const tokens = await this.generateTokens(user.id, tenant.id, user.email, user.role);

    this.logger.log(`User registered: ${user.email} for tenant: ${tenant.name}`);

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      ...tokens,
    };
  }

  /** Maximum failed login attempts before account lockout */
  private readonly MAX_FAILED_ATTEMPTS = 5;

  /** Lockout duration in minutes */
  private readonly LOCKOUT_DURATION_MINUTES = 30;

  async login(dto: LoginDto) {
    // Use a tenant-scoped query to find the user.
    // First, find the user without RLS to get the tenantId (auth is pre-session).
    // We use $queryRawUnsafe to bypass RLS for the initial lookup.
    const users = await this.db.client.$queryRawUnsafe<
      Array<{
        id: string;
        tenantId: string;
        email: string;
        name: string;
        passwordHash: string | null;
        role: string;
        failedLoginAttempts: number;
        lockedUntil: Date | null;
      }>
    >(
      `SELECT id, "tenantId", email, name, "passwordHash", role, "failedLoginAttempts", "lockedUntil"
       FROM users WHERE email = $1 LIMIT 1`,
      dto.email,
    );

    const userRow = users[0];

    if (!userRow || !userRow.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is locked
    if (userRow.lockedUntil && userRow.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil((userRow.lockedUntil.getTime() - Date.now()) / 60_000);
      this.logger.warn(
        `Login blocked — account locked: ${userRow.email} (${remainingMinutes}m remaining)`,
      );
      throw new UnauthorizedException(
        `Account is locked due to too many failed attempts. Try again in ${remainingMinutes} minute(s).`,
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, userRow.passwordHash);
    if (!isPasswordValid) {
      const attempts = (userRow.failedLoginAttempts ?? 0) + 1;
      const updateData: { failedLoginAttempts: number; lockedUntil?: Date } = {
        failedLoginAttempts: attempts,
      };

      if (attempts >= this.MAX_FAILED_ATTEMPTS) {
        updateData.lockedUntil = new Date(Date.now() + this.LOCKOUT_DURATION_MINUTES * 60_000);
        this.logger.warn(`Account locked after ${attempts} failed attempts: ${userRow.email}`);
      }

      // Use forTenant so RLS context is set for the update
      await this.db.forTenant(userRow.tenantId, async (tx) => {
        await tx.user.update({
          where: { id: userRow.id },
          data: updateData,
        });
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful login — reset failed attempts counter
    if (userRow.failedLoginAttempts > 0 || userRow.lockedUntil) {
      await this.db.forTenant(userRow.tenantId, async (tx) => {
        await tx.user.update({
          where: { id: userRow.id },
          data: { failedLoginAttempts: 0, lockedUntil: null },
        });
      });
    }

    const tokens = await this.generateTokens(
      userRow.id,
      userRow.tenantId,
      userRow.email,
      userRow.role,
    );

    this.logger.log(`User logged in: ${userRow.email}`);

    // Fetch tenant info separately (tenants table may also have RLS)
    const tenant = await this.db.client.$queryRawUnsafe<
      Array<{ id: string; name: string; slug: string; settings: unknown }>
    >(`SELECT id, name, slug, settings FROM tenants WHERE id = $1 LIMIT 1`, userRow.tenantId);

    const tenantRow = tenant[0];

    return {
      user: { id: userRow.id, email: userRow.email, name: userRow.name, role: userRow.role },
      tenant: tenantRow
        ? {
            id: tenantRow.id,
            name: tenantRow.name,
            slug: tenantRow.slug,
            settings: tenantRow.settings,
          }
        : null,
      ...tokens,
    };
  }

  /**
   * Authenticate via Azure AD. Auto-provisions user on first login.
   * Called after the OAuth2 callback validates the Azure AD token.
   */
  async loginWithAzureAd(profile: { oid: string; email: string; name: string; tenantId?: string }) {
    // Try to find existing user by Azure AD OID (bypass RLS — pre-auth)
    const oidUsers = await this.db.client.$queryRawUnsafe<
      Array<{ id: string; tenantId: string; email: string; name: string; role: string }>
    >(
      `SELECT id, "tenantId", email, name, role FROM users WHERE "azureAdOid" = $1 LIMIT 1`,
      profile.oid,
    );
    let user = oidUsers[0] ?? null;

    if (!user) {
      // Try to find by email (linking existing account) — bypass RLS
      const emailUsers = await this.db.client.$queryRawUnsafe<
        Array<{ id: string; tenantId: string; email: string; name: string; role: string }>
      >(
        `SELECT id, "tenantId", email, name, role FROM users WHERE email = $1 LIMIT 1`,
        profile.email,
      );
      const foundUser = emailUsers[0] ?? null;

      if (foundUser) {
        // Link Azure AD OID to existing account — use forTenant for the update
        await this.db.forTenant(foundUser.tenantId, async (tx) => {
          await tx.user.update({
            where: { id: foundUser.id },
            data: { azureAdOid: profile.oid, name: profile.name || foundUser.name },
          });
        });
        user = { ...foundUser, name: profile.name || foundUser.name };
        this.logger.log(`Linked Azure AD to existing user: ${user.email}`);
      } else {
        // Auto-provision: create tenant and user
        const slug = profile.email
          .split('@')[0]!
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-');

        const tenant = await this.db.client.tenant.create({
          data: {
            name: `${profile.name}'s Organization`,
            slug: `${slug}-${Date.now()}`,
            users: {
              create: {
                email: profile.email,
                name: profile.name,
                azureAdOid: profile.oid,
                role: 'ADMIN',
              },
            },
          },
          include: { users: true },
        });

        user = tenant.users[0]!;
        this.logger.log(`Auto-provisioned Azure AD user: ${user.email}`);
      }
    }

    const tokens = await this.generateTokens(user.id, user.tenantId, user.email, user.role);
    this.logger.log(`Azure AD login: ${user.email}`);

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...tokens,
    };
  }

  /**
   * Refresh tokens using token family rotation pattern.
   *
   * How it works:
   * 1. Each login creates a "token family" (a group of refresh tokens from one session).
   * 2. When a refresh token is used, it is revoked and a new one is issued in the same family.
   * 3. If a revoked token is reused (indicating theft), ALL tokens in the family are revoked.
   */
  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);

    // Look up the stored token record
    const storedToken = await this.db.client.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken) {
      // Token not found — could be from before rotation was enabled, or invalid
      throw new UnauthorizedException('Invalid refresh token');
    }

    // REUSE DETECTION: If the token was already revoked, someone is replaying it.
    // Revoke the entire family to protect the user.
    if (storedToken.revoked) {
      this.logger.warn(
        `Refresh token reuse detected for user ${storedToken.userId}, family ${storedToken.familyId}. Revoking entire family.`,
      );
      await this.db.client.refreshToken.updateMany({
        where: { familyId: storedToken.familyId },
        data: { revoked: true },
      });
      throw new UnauthorizedException('Refresh token reuse detected — session invalidated');
    }

    // Check expiry (belt-and-suspenders with JWT expiry)
    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke the current token (it's been used)
    await this.db.client.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    // Fetch user — bypass RLS since this is pre-session
    const userRows = await this.db.client.$queryRawUnsafe<
      Array<{ id: string; tenantId: string; email: string; role: string }>
    >(`SELECT id, "tenantId", email, role FROM users WHERE id = $1 LIMIT 1`, payload.sub);

    const user = userRows[0];
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Issue new tokens in the same family
    return this.generateTokens(user.id, user.tenantId, user.email, user.role, storedToken.familyId);
  }

  /**
   * Resolve tenant branding from a hostname/domain.
   * Public endpoint — returns only non-sensitive branding info.
   */
  async resolveTenantBranding(domain: string) {
    // Extract subdomain: "standardbank.compportiq.ai" → "standardbank"
    const parts = domain.split('.');
    const subdomain = parts.length >= 3 ? parts[0] : null;

    // Try to find tenant by: subdomain field → slug → customDomain
    const tenant = await this.db.client.tenant.findFirst({
      where: {
        isActive: true,
        OR: [...(subdomain ? [{ subdomain }, { slug: subdomain }] : []), { customDomain: domain }],
      },
      select: {
        name: true,
        slug: true,
        subdomain: true,
        logoUrl: true,
        primaryColor: true,
      },
    });

    if (!tenant) return null;

    // Check if Azure AD SSO is configured (globally for now)
    const azureAdEnabled = !!(
      this.configService.get<string>('AZURE_AD_CLIENT_ID') &&
      this.configService.get<string>('AZURE_AD_TENANT_ID')
    );

    return {
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
      azureAdEnabled,
    };
  }

  /**
   * Generate access + refresh tokens.
   * Stores the refresh token hash in the database for rotation tracking.
   *
   * @param familyId - Reuse the same family for token rotation within a session.
   *                   Pass undefined to start a new family (login).
   */
  private async generateTokens(
    userId: string,
    tenantId: string,
    email: string,
    role: string,
    familyId?: string,
  ) {
    const payload: JwtPayload = { sub: userId, tenantId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '15m' }),
      this.jwtService.signAsync(payload, { expiresIn: '7d' }),
    ]);

    // Store refresh token hash for rotation tracking
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db.client.refreshToken.create({
      data: {
        userId,
        tokenHash,
        familyId: familyId ?? crypto.randomUUID(),
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  /** SHA-256 hash of a token string — we never store raw tokens. */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
