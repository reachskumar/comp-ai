import {
  Body,
  Controller,
  Delete,
  Post,
  UseGuards,
  Get,
  Param,
  Query,
  Res,
  Request,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000, blockDuration: 900000 } })
  @ApiOperation({ summary: 'Register a new user and tenant' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000, blockDuration: 900000 } })
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 5, ttl: 60000, blockDuration: 900000 } })
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user info' })
  getMe(
    @Request() req: { user: { userId: string; tenantId: string; email: string; role: string } },
  ) {
    return req.user;
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke tokens' })
  async logout(
    @Request() req: { user: { userId: string; tenantId: string } },
    @Body() body: { refreshToken?: string },
  ) {
    // Decode JTIs from tokens to blacklist them
    let accessJti: string | undefined;
    let refreshJti: string | undefined;

    try {
      const authHeader = (req as unknown as { headers: Record<string, string> }).headers?.authorization;
      if (authHeader) {
        const decoded = this.authService['jwtService'].decode(authHeader.replace('Bearer ', ''));
        accessJti = (decoded as Record<string, string>)?.jti;
      }
    } catch { /* best effort */ }

    if (body.refreshToken) {
      try {
        const decoded = this.authService['jwtService'].decode(body.refreshToken);
        refreshJti = (decoded as Record<string, string>)?.jti;
      } catch { /* best effort */ }
    }

    await this.authService.logout(req.user.userId, req.user.tenantId, accessJti, refreshJti);
    return { message: 'Logged out successfully' };
  }

  // ─── Session Management ───────────────────────────────────

  @Get('sessions')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active sessions for current user' })
  async listSessions(
    @Request() req: { user: { userId: string; tenantId: string } },
  ) {
    return this.authService.listSessions(req.user.userId, req.user.tenantId);
  }

  @Post('sessions/:sessionId/terminate')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Terminate a specific session' })
  async terminateSession(
    @Request() req: { user: { userId: string; tenantId: string } },
    @Param('sessionId') sessionId: string,
  ) {
    return this.authService.terminateSession(req.user.userId, req.user.tenantId, sessionId);
  }

  @Post('sessions/terminate-all')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Terminate all other sessions (keep current)' })
  async terminateAllSessions(
    @Request() req: { user: { userId: string; tenantId: string } },
  ) {
    // Extract current session JTI to keep it alive
    let currentJti: string | undefined;
    try {
      const authHeader = (req as unknown as { headers: Record<string, string> }).headers?.authorization;
      if (authHeader) {
        const decoded = this.authService['jwtService'].decode(authHeader.replace('Bearer ', ''));
        currentJti = (decoded as Record<string, string>)?.jti;
      }
    } catch { /* best effort */ }

    await this.authService.terminateAllSessions(req.user.userId, req.user.tenantId, currentJti);
    return { message: 'All other sessions terminated' };
  }

  // ─── GDPR Data Deletion ───────────────────────────────────

  @Delete('user/:userId')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete user data (GDPR right-to-erasure)' })
  async deleteUserData(
    @Request() req: { user: { userId: string; tenantId: string; role: string } },
    @Param('userId') targetUserId: string,
  ) {
    // Only admins or the user themselves can delete
    if (req.user.role !== 'ADMIN' && req.user.role !== 'PLATFORM_ADMIN' && req.user.userId !== targetUserId) {
      throw new UnauthorizedException('Only admins can delete other users');
    }
    return this.authService.deleteUserData(req.user.tenantId, targetUserId);
  }

  // ─── Tenant Branding (Public) ──────────────────────────────

  @Get('tenant-branding')
  @ApiOperation({ summary: 'Resolve tenant branding from domain/subdomain (public, no auth)' })
  async getTenantBranding(@Query('domain') domain: string) {
    if (!domain) {
      return { found: false };
    }
    const branding = await this.authService.resolveTenantBranding(domain);
    if (!branding) {
      return { found: false };
    }
    return { found: true, ...branding };
  }

  // ─── Azure AD SSO ─────────────────────────────────────────
  @Get('azure')
  @ApiOperation({ summary: 'Initiate Azure AD SSO login' })
  azureLogin(@Res() reply: FastifyReply) {
    const clientId = this.configService.get<string>('AZURE_AD_CLIENT_ID');
    const tenantId = this.configService.get<string>('AZURE_AD_TENANT_ID');
    const redirectUri = this.configService.get<string>('AZURE_AD_REDIRECT_URI');

    if (!clientId || !tenantId) {
      return reply.status(501).send({ message: 'Azure AD SSO is not configured' });
    }

    const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri ?? '');
    authUrl.searchParams.set('scope', 'openid profile email User.Read');
    authUrl.searchParams.set('response_mode', 'query');

    return reply.redirect(authUrl.toString(), 302);
  }

  @Get('azure/callback')
  @ApiOperation({ summary: 'Azure AD OAuth2 callback' })
  async azureCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() reply: FastifyReply,
  ) {
    const frontendUrl = this.configService.get<string>('NEXTAUTH_URL') ?? 'http://localhost:3000';

    if (error) {
      this.logger.error(`Azure AD error: ${error} — ${errorDescription}`);
      return reply.redirect(`${frontendUrl}/login?error=azure_ad_error`, 302);
    }

    if (!code) {
      return reply.redirect(`${frontendUrl}/login?error=no_code`, 302);
    }

    try {
      const clientId = this.configService.get<string>('AZURE_AD_CLIENT_ID')!;
      const clientSecret = this.configService.get<string>('AZURE_AD_CLIENT_SECRET')!;
      const tenantId = this.configService.get<string>('AZURE_AD_TENANT_ID')!;
      const redirectUri = this.configService.get<string>('AZURE_AD_REDIRECT_URI')!;

      // Exchange code for tokens
      // Use explicit typing to avoid @types/node version mismatches across build envs
      type FetchResponse = {
        ok: boolean;
        status: number;
        text(): Promise<string>;
        json(): Promise<unknown>;
      };

      const tokenRes = (await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            scope: 'openid profile email User.Read',
          }),
        },
      )) as unknown as FetchResponse;

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        this.logger.error(`Token exchange failed: ${err}`);
        return reply.redirect(`${frontendUrl}/login?error=token_exchange_failed`, 302);
      }

      const tokenData = (await tokenRes.json()) as { access_token: string };

      // Fetch user profile from Microsoft Graph
      const profileRes = (await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })) as unknown as FetchResponse;

      if (!profileRes.ok) {
        return reply.redirect(`${frontendUrl}/login?error=profile_fetch_failed`, 302);
      }

      const profile = (await profileRes.json()) as {
        id: string;
        mail?: string;
        userPrincipalName: string;
        displayName: string;
      };

      // Login/provision via auth service
      const result = await this.authService.loginWithAzureAd({
        oid: profile.id,
        email: profile.mail ?? profile.userPrincipalName,
        name: profile.displayName,
      });

      // Redirect to frontend with tokens as query params
      const callbackUrl = new URL(`${frontendUrl}/auth/callback`);
      callbackUrl.searchParams.set('accessToken', result.accessToken);
      callbackUrl.searchParams.set('refreshToken', result.refreshToken);
      callbackUrl.searchParams.set('user', JSON.stringify(result.user));

      return reply.redirect(callbackUrl.toString(), 302);
    } catch (err) {
      this.logger.error('Azure AD callback error', err);
      return reply.redirect(`${frontendUrl}/login?error=internal_error`, 302);
    }
  }

  @Get('azure/config')
  @ApiOperation({ summary: 'Check if Azure AD SSO is configured' })
  azureConfig() {
    const clientId = this.configService.get<string>('AZURE_AD_CLIENT_ID');
    return { enabled: !!clientId };
  }
}
