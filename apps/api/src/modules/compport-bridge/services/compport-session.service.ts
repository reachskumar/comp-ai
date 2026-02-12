import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { CompportBridgeConfig } from '../config/compport-bridge.config';
import { DatabaseService } from '../../../database';
import { UserRole } from '@compensation/database';

interface CompportTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  tenant_id: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
}

/**
 * Session bridge for JWT token exchange between Compport PHP and this platform.
 * SECURITY:
 * - Validates token signature (HMAC-SHA256)
 * - Validates token expiry
 * - Validates issuer claim
 * - Validates audience claim
 * - Rejects replayed tokens via jti (nonce) tracking
 * - Auto-provisions users on first login from Compport
 * - Never logs token values
 */
@Injectable()
export class CompportSessionService {
  private readonly logger = new Logger(CompportSessionService.name);
  private readonly EXPECTED_ISSUER = 'compport-php';
  private readonly EXPECTED_AUDIENCE = 'compport-nextgen';
  // In-memory jti store for replay protection (production should use Redis)
  private readonly usedJtis = new Map<string, number>();
  private readonly JTI_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  private readonly JTI_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(
    private readonly config: CompportBridgeConfig,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly db: DatabaseService,
  ) {
    // Periodically clean up expired jtis
    setInterval(() => this.cleanupJtis(), this.JTI_CLEANUP_INTERVAL_MS);
  }

  /**
   * Exchange a Compport PHP session token for a platform JWT.
   * SECURITY: Full validation chain before issuing platform token.
   */
  async exchangeToken(compportToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string; name: string; role: string };
  }> {
    if (this.config.isStandalone) {
      throw new UnauthorizedException('Token exchange not available in standalone mode');
    }

    // Step 1: Verify token signature
    const payload = this.verifyCompportToken(compportToken);

    // Step 2: Validate claims
    this.validateClaims(payload);

    // Step 3: Check replay (jti)
    this.checkReplay(payload.jti);

    // Step 4: Auto-provision or find user
    const user = await this.findOrCreateUser(payload);

    // Step 5: Issue platform tokens
    const platformPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(platformPayload, { expiresIn: '15m' }),
      this.jwtService.signAsync(platformPayload, { expiresIn: '7d' }),
    ]);

    this.logger.log(`Token exchanged for user: ${user.email} (auto-provisioned: ${user.wasCreated})`);

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  /**
   * Verify Compport token signature using HMAC-SHA256.
   * SECURITY: Never log the token value.
   */
  private verifyCompportToken(token: string): CompportTokenPayload {
    const secret = this.config.sessionSecret;
    if (!secret) {
      throw new UnauthorizedException('Session bridge not configured');
    }

    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid token format');
      }

      const [headerB64, payloadB64, signatureB64] = parts;
      // Verify HMAC-SHA256 signature
      const expectedSig = crypto
        .createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');

      if (!crypto.timingSafeEqual(
        Buffer.from(signatureB64!),
        Buffer.from(expectedSig),
      )) {
        throw new Error('Invalid signature');
      }

      const payload = JSON.parse(
        Buffer.from(payloadB64!, 'base64url').toString('utf-8'),
      ) as CompportTokenPayload;

      return payload;
    } catch (error) {
      // SECURITY: Do not expose token details in error
      this.logger.warn('Compport token verification failed');
      throw new UnauthorizedException('Invalid Compport session token');
    }
  }

  /**
   * Validate token claims: issuer, audience, expiry.
   */
  private validateClaims(payload: CompportTokenPayload): void {
    // Check issuer
    if (payload.iss !== this.EXPECTED_ISSUER) {
      this.logger.warn(`Invalid issuer: expected "${this.EXPECTED_ISSUER}"`);
      throw new UnauthorizedException('Invalid token issuer');
    }

    // Check audience
    if (payload.aud !== this.EXPECTED_AUDIENCE) {
      this.logger.warn(`Invalid audience: expected "${this.EXPECTED_AUDIENCE}"`);
      throw new UnauthorizedException('Invalid token audience');
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      throw new UnauthorizedException('Token has expired');
    }

    // Check required fields
    if (!payload.sub || !payload.email || !payload.tenant_id) {
      throw new UnauthorizedException('Token missing required claims');
    }
  }

  /**
   * Check for token replay using jti claim.
   * SECURITY: Prevents token reuse attacks.
   */
  private checkReplay(jti: string): void {
    if (!jti) {
      throw new UnauthorizedException('Token missing jti claim (replay protection)');
    }

    if (this.usedJtis.has(jti)) {
      this.logger.warn('Replayed token detected');
      throw new UnauthorizedException('Token has already been used');
    }

    this.usedJtis.set(jti, Date.now());
  }

  /**
   * Find existing user or auto-provision on first login from Compport.
   */
  private async findOrCreateUser(payload: CompportTokenPayload): Promise<{
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string;
    wasCreated: boolean;
  }> {
    // Find existing user by email within the tenant
    const existingUser = await this.db.client.user.findFirst({
      where: { email: payload.email, tenantId: payload.tenant_id },
    });

    if (existingUser) {
      return {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        role: existingUser.role,
        tenantId: existingUser.tenantId,
        wasCreated: false,
      };
    }

    // Auto-provision user
    const mapRole = (phpRole: string): UserRole => {
      const roleMap: Record<string, UserRole> = {
        admin: UserRole.ADMIN,
        manager: UserRole.MANAGER,
        hr: UserRole.HR_MANAGER,
        hr_manager: UserRole.HR_MANAGER,
        analyst: UserRole.ANALYST,
        viewer: UserRole.EMPLOYEE,
        employee: UserRole.EMPLOYEE,
      };
      return roleMap[phpRole.toLowerCase()] ?? UserRole.EMPLOYEE;
    };

    const newUser = await this.db.client.user.create({
      data: {
        email: payload.email,
        name: payload.name || payload.email.split('@')[0] || 'Compport User',
        role: mapRole(payload.role),
        tenantId: payload.tenant_id,
        passwordHash: '', // No password — SSO only
      },
    });

    this.logger.log(`Auto-provisioned user from Compport: ${newUser.email}`);

    return {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      tenantId: newUser.tenantId,
      wasCreated: true,
    };
  }

  /**
   * Clean up expired jtis to prevent memory leaks.
   */
  private cleanupJtis(): void {
    const cutoff = Date.now() - this.JTI_MAX_AGE_MS;
    let cleaned = 0;
    for (const [jti, timestamp] of this.usedJtis.entries()) {
      if (timestamp < cutoff) {
        this.usedJtis.delete(jti);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired jtis`);
    }
  }
}

