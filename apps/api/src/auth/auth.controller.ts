import {
  Body,
  Controller,
  Post,
  UseGuards,
  Get,
  Query,
  Res,
  Request,
  Logger,
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

    return reply.redirect(302, authUrl.toString());
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
      return reply.redirect(302, `${frontendUrl}/login?error=azure_ad_error`);
    }

    if (!code) {
      return reply.redirect(302, `${frontendUrl}/login?error=no_code`);
    }

    try {
      const clientId = this.configService.get<string>('AZURE_AD_CLIENT_ID')!;
      const clientSecret = this.configService.get<string>('AZURE_AD_CLIENT_SECRET')!;
      const tenantId = this.configService.get<string>('AZURE_AD_TENANT_ID')!;
      const redirectUri = this.configService.get<string>('AZURE_AD_REDIRECT_URI')!;

      // Exchange code for tokens
      const tokenRes = await fetch(
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
      );

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        this.logger.error(`Token exchange failed: ${err}`);
        return reply.redirect(302, `${frontendUrl}/login?error=token_exchange_failed`);
      }

      const tokenData = (await tokenRes.json()) as { access_token: string };

      // Fetch user profile from Microsoft Graph
      const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!profileRes.ok) {
        return reply.redirect(302, `${frontendUrl}/login?error=profile_fetch_failed`);
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

      return reply.redirect(302, callbackUrl.toString());
    } catch (err) {
      this.logger.error('Azure AD callback error', err);
      return reply.redirect(302, `${frontendUrl}/login?error=internal_error`);
    }
  }

  @Get('azure/config')
  @ApiOperation({ summary: 'Check if Azure AD SSO is configured' })
  azureConfig() {
    const clientId = this.configService.get<string>('AZURE_AD_CLIENT_ID');
    return { enabled: !!clientId };
  }
}
