import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../database';
import { RegisterDto, LoginDto } from './dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.db.client.user.findFirst({
      where: { email: dto.email },
    });

    if (existing) {
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

  async login(dto: LoginDto) {
    const user = await this.db.client.user.findFirst({
      where: { email: dto.email },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Account lockout check
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMs = user.lockedUntil.getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60_000);
      throw new UnauthorizedException(
        `Account locked due to too many failed attempts. Try again in ${remainingMin} minutes.`,
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      const newCount = user.failedLoginCount + 1;
      const updateData: Record<string, unknown> = { failedLoginCount: newCount };

      if (newCount >= MAX_FAILED_ATTEMPTS) {
        updateData.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        this.logger.warn(`Account locked after ${newCount} failed attempts: ${user.email}`);
      }

      await this.db.client.user.update({
        where: { id: user.id },
        data: updateData,
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed login count on successful login
    await this.db.client.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(user.id, user.tenantId, user.email, user.role);

    this.logger.log(`User logged in: ${user.email}`);

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      ...tokens,
    };
  }

  /**
   * Authenticate via Azure AD. Auto-provisions user on first login.
   * Called after the OAuth2 callback validates the Azure AD token.
   */
  async loginWithAzureAd(profile: { oid: string; email: string; name: string; tenantId?: string }) {
    // Try to find existing user by Azure AD OID
    let user = await this.db.client.user.findFirst({
      where: { azureAdOid: profile.oid },
    });

    if (!user) {
      // Try to find by email (linking existing account)
      user = await this.db.client.user.findFirst({
        where: { email: profile.email },
      });

      if (user) {
        // Link Azure AD OID to existing account
        user = await this.db.client.user.update({
          where: { id: user.id },
          data: { azureAdOid: profile.oid, name: profile.name || user.name },
        });
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

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload & { jti?: string }>(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      // Check if token is blacklisted (logged out)
      if (payload.jti) {
        const blacklisted = await this.db.client.tokenBlacklist.findUnique({
          where: { jti: payload.jti },
        });
        if (blacklisted) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }

      const user = await this.db.client.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      return this.generateTokens(user.id, user.tenantId, user.email, user.role);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  // ─── Logout / Token Revocation ────────────────────────────

  async logout(userId: string, tenantId: string, accessJti?: string, refreshJti?: string) {
    const jtis = [accessJti, refreshJti].filter(Boolean) as string[];

    for (const jti of jtis) {
      await this.db.client.tokenBlacklist.upsert({
        where: { jti },
        update: {},
        create: {
          jti,
          userId,
          tenantId,
          reason: 'logout',
          expiresAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000), // 8 days (> refresh token TTL)
        },
      });
    }

    // Remove associated sessions
    if (accessJti) {
      await this.db.client.userSession.deleteMany({ where: { jti: accessJti } });
    }

    // Back-channel logout: notify Compport PHP to invalidate their session
    try {
      const compportApiUrl = this.configService.get<string>('COMPPORT_API_URL');
      const compportApiKey = this.configService.get<string>('COMPPORT_API_KEY');
      const compportMode = this.configService.get<string>('COMPPORT_MODE');

      if (compportMode !== 'standalone' && compportApiUrl && compportApiKey) {
        fetch(`${compportApiUrl}/api/v1/session/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': compportApiKey,
          },
          body: JSON.stringify({ userId, tenantId, timestamp: Date.now() }),
          signal: AbortSignal.timeout(5_000),
        }).catch(() => {
          // Non-blocking: don't fail logout if Compport is unreachable
        });
      }
    } catch {
      // Swallow — Compport notification is best-effort
    }

    this.logger.log(`User logged out: ${userId}`);
  }

  // ─── Session Management ───────────────────────────────────

  async listSessions(userId: string, tenantId: string) {
    return this.db.forTenant(tenantId, (tx) =>
      tx.userSession.findMany({
        where: { userId, expiresAt: { gt: new Date() } },
        orderBy: { lastActiveAt: 'desc' },
      }),
    );
  }

  async terminateSession(userId: string, tenantId: string, sessionId: string) {
    const session = await this.db.forTenant(tenantId, (tx) =>
      tx.userSession.findFirst({ where: { id: sessionId, userId } }),
    ) as { id: string; jti: string; expiresAt: Date } | null;

    if (!session) return { terminated: false };

    // Blacklist the session's token
    await this.db.client.tokenBlacklist.upsert({
      where: { jti: session.jti },
      update: {},
      create: {
        jti: session.jti,
        userId,
        tenantId,
        reason: 'admin_terminated',
        expiresAt: session.expiresAt,
      },
    });

    await this.db.client.userSession.delete({ where: { id: sessionId } });

    this.logger.log(`Session ${sessionId} terminated for user ${userId}`);
    return { terminated: true };
  }

  async terminateAllSessions(userId: string, tenantId: string, exceptJti?: string) {
    const sessions = await this.db.forTenant(tenantId, (tx) =>
      tx.userSession.findMany({ where: { userId } }),
    ) as Array<{ jti: string; expiresAt: Date }>;

    for (const session of sessions) {
      if (session.jti === exceptJti) continue;
      await this.db.client.tokenBlacklist.upsert({
        where: { jti: session.jti },
        update: {},
        create: {
          jti: session.jti,
          userId,
          tenantId,
          reason: 'terminate_all',
          expiresAt: session.expiresAt,
        },
      });
    }

    const deleteWhere: Record<string, unknown> = { userId };
    if (exceptJti) deleteWhere.jti = { not: exceptJti };
    await this.db.client.userSession.deleteMany({ where: deleteWhere });

    this.logger.log(`All sessions terminated for user ${userId} (except ${exceptJti ?? 'none'})`);
  }

  // ─── GDPR Data Deletion ───────────────────────────────────

  async deleteUserData(tenantId: string, targetUserId: string) {
    return this.db.forTenant(tenantId, async (tx) => {
      // Delete sessions and blacklisted tokens
      await tx.userSession.deleteMany({ where: { userId: targetUserId } });
      await tx.tokenBlacklist.deleteMany({ where: { userId: targetUserId } });

      // Anonymize audit logs (keep structure, remove PII)
      await tx.auditLog.updateMany({
        where: { userId: targetUserId },
        data: { userId: 'DELETED_USER' },
      });

      // Delete notifications
      await tx.notification.deleteMany({ where: { userId: targetUserId } });

      // Delete the user record
      await tx.user.delete({ where: { id: targetUserId } });

      return { deleted: true, userId: targetUserId };
    });
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

  private async generateTokens(userId: string, tenantId: string, email: string, role: string) {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();
    const payload: JwtPayload = { sub: userId, tenantId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ ...payload, jti: accessJti }, { expiresIn: '15m' }),
      this.jwtService.signAsync({ ...payload, jti: refreshJti }, { expiresIn: '7d' }),
    ]);

    // Track session
    await this.db.client.userSession.create({
      data: {
        userId,
        tenantId,
        jti: accessJti,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    }).catch(() => {
      // Non-critical: don't block login if session tracking fails
      this.logger.warn(`Failed to track session for user ${userId}`);
    });

    return { accessToken, refreshToken };
  }
}
