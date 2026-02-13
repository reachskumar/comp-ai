import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { BridgeRateLimitGuard } from './guards/bridge-rate-limit.guard';
import { CompportBridgeConfig } from './config/compport-bridge.config';
import { CompportDbService } from './services/compport-db.service';
import { CompportApiService } from './services/compport-api.service';
import { CompportSessionService } from './services/compport-session.service';
import { ExchangeTokenDto } from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

/**
 * Compport PHP Bridge endpoints.
 * SECURITY:
 * - All endpoints require JWT auth (except token exchange which validates Compport tokens)
 * - Rate limited to 100 req/min per tenant
 * - Audit logging on all sync operations
 */
@ApiTags('compport-bridge')
@Controller('compport-bridge')
export class CompportBridgeController {
  private readonly logger = new Logger(CompportBridgeController.name);

  constructor(
    private readonly config: CompportBridgeConfig,
    private readonly dbService: CompportDbService,
    private readonly apiService: CompportApiService,
    private readonly sessionService: CompportSessionService,
  ) {}

  // ─── Status ──────────────────────────────────────────────────

  @Get('status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, BridgeRateLimitGuard)
  @ApiOperation({ summary: 'Get Compport bridge status and configuration' })
  getStatus(@Request() req: AuthRequest) {
    return {
      mode: this.config.mode,
      isStandalone: this.config.isStandalone,
      apiConfigured: !!this.config.apiUrl,
      // SECURITY: Mask API key in response
      apiKeyConfigured: !!this.config.apiKey,
      dbPrefix: this.config.dbPrefix,
      sessionBridgeConfigured: !!this.config.sessionSecret,
      tenantId: req.user.tenantId,
    };
  }

  // ─── Employee Sync ───────────────────────────────────────────

  @Get('employees')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, BridgeRateLimitGuard)
  @ApiOperation({ summary: 'Fetch employees from Compport (shared DB or API bridge)' })
  async getEmployees(@Request() req: AuthRequest) {
    // AUDIT: Log sync operation
    this.logger.log(
      `Employee sync requested by user=${req.user.userId} tenant=${req.user.tenantId} mode=${this.config.mode}`,
    );

    if (this.config.isSharedDb) {
      return { source: 'shared_db', data: await this.dbService.getEmployees(req.user.tenantId) };
    }
    if (this.config.isApiBridge) {
      return { source: 'api_bridge', data: await this.apiService.fetchEmployees(req.user.tenantId) };
    }
    return { source: 'standalone', data: [] };
  }

  // ─── Compensation Data ───────────────────────────────────────

  @Get('compensation')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, BridgeRateLimitGuard)
  @ApiOperation({ summary: 'Fetch compensation data from Compport' })
  async getCompensation(@Request() req: AuthRequest) {
    this.logger.log(
      `Compensation sync requested by user=${req.user.userId} tenant=${req.user.tenantId} mode=${this.config.mode}`,
    );

    if (this.config.isSharedDb) {
      return { source: 'shared_db', data: await this.dbService.getCompensationData(req.user.tenantId) };
    }
    if (this.config.isApiBridge) {
      return { source: 'api_bridge', data: await this.apiService.fetchCompensationData(req.user.tenantId) };
    }
    return { source: 'standalone', data: [] };
  }

  // ─── User Sync ───────────────────────────────────────────────

  @Post('sync/employees')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, BridgeRateLimitGuard)
  @ApiOperation({ summary: 'Trigger employee sync from Compport API' })
  async syncEmployees(@Request() req: AuthRequest) {
    this.logger.log(
      `Employee sync triggered by user=${req.user.userId} tenant=${req.user.tenantId}`,
    );
    return this.apiService.syncEmployees(req.user.tenantId);
  }

  @Post('sync/users')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, BridgeRateLimitGuard)
  @ApiOperation({ summary: 'Trigger user sync from Compport API' })
  async syncUsers(@Request() req: AuthRequest) {
    this.logger.log(
      `User sync triggered by user=${req.user.userId} tenant=${req.user.tenantId}`,
    );
    return this.apiService.syncUsers(req.user.tenantId);
  }

  // ─── Session Bridge ──────────────────────────────────────────

  @Post('session/exchange')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, BridgeRateLimitGuard)
  @ApiOperation({ summary: 'Exchange a Compport PHP session token for a platform JWT' })
  async exchangeToken(@Body() dto: ExchangeTokenDto) {
    return this.sessionService.exchangeToken(dto.token);
  }

  // ─── Cache Management ────────────────────────────────────────

  @Post('cache/clear')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, BridgeRateLimitGuard)
  @ApiOperation({ summary: 'Clear the Compport API response cache' })
  clearCache(@Request() req: AuthRequest) {
    this.logger.log(`Cache cleared by user=${req.user.userId} tenant=${req.user.tenantId}`);
    this.apiService.clearCache();
    return { cleared: true };
  }
}

