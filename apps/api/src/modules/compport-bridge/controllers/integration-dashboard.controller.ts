import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth';
import { PlatformAdminGuard } from '../../platform-admin/guards/platform-admin.guard';
import { IntegrationDashboardService } from '../services/integration-dashboard.service';
import { CompportCloudSqlService } from '../services/compport-cloudsql.service';

/**
 * Integration Dashboard Controller — Platform Admin only.
 *
 * Provides visibility into:
 * - Cloud SQL connection health
 * - Per-tenant sync status and data metrics
 * - Compport module discovery per customer
 * - Write-back stats across all tenants
 * - Onboarding pipeline (discovered vs provisioned)
 */
@ApiTags('platform-admin / integration-dashboard')
@Controller('platform-admin/integrations')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class IntegrationDashboardController {
  private readonly logger = new Logger(IntegrationDashboardController.name);

  constructor(
    private readonly dashboard: IntegrationDashboardService,
    private readonly cloudSql: CompportCloudSqlService,
  ) {}

  // ─── Platform-Wide Stats ────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide integration statistics (connections, syncs, write-backs)' })
  async getStats() {
    return this.dashboard.getPlatformStats();
  }

  // ─── Tenant Sync Overview ───────────────────────────────

  @Get('tenants')
  @ApiOperation({ summary: 'All tenants with sync status, data counts, connection health' })
  async getTenantOverviews(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.dashboard.getTenantSyncOverviews(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
    );
  }

  // ─── Per-Tenant Detail ──────────────────────────────────

  @Get('tenants/:tenantId/sync-history')
  @ApiOperation({ summary: 'Sync job history for a specific tenant' })
  async getTenantSyncHistory(
    @Param('tenantId') tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboard.getTenantSyncHistory(
      tenantId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('tenants/:schemaName/modules')
  @ApiOperation({ summary: 'Discover which Compport modules a tenant has from Cloud SQL schema' })
  async discoverModules(@Param('schemaName') schemaName: string) {
    return this.dashboard.discoverTenantModules(schemaName);
  }

  // ─── Onboarding Pipeline ────────────────────────────────

  @Get('onboarding-status')
  @ApiOperation({ summary: 'Compport tenants discovered vs onboarded — shows pending onboarding' })
  async getOnboardingStatus() {
    return this.dashboard.getOnboardingStatus();
  }

  // ─── Connection Health ──────────────────────────────────

  @Get('connection-status')
  @ApiOperation({ summary: 'Cloud SQL connection pool health and status' })
  getConnectionStatus() {
    return this.cloudSql.getPoolStatus();
  }
}
