import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
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

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

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
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const user = await this.db.client.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      return this.generateTokens(user.id, user.tenantId, user.email, user.role);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
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
    const payload: JwtPayload = { sub: userId, tenantId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '15m' }),
      this.jwtService.signAsync(payload, { expiresIn: '7d' }),
    ]);

    return { accessToken, refreshToken };
  }
}
