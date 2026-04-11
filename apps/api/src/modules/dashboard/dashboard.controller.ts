import { Controller, Get, UseGuards, Request, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard, PermissionGuard, RequirePermission } from '../../common';
import { DashboardService } from './dashboard.service';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@RequirePermission('Dashboard', 'view')
@Controller('dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get dashboard summary stats and recent activity' })
  async getSummary(@Request() req: AuthRequest) {
    this.logger.log(`Dashboard summary: tenant=${req.user.tenantId}`);
    return this.dashboardService.getSummary(req.user.tenantId);
  }

  @Get('sync-status/current')
  @ApiOperation({
    summary:
      'Most recent full-sync job for this tenant. UI polls this to show a live progress banner.',
  })
  async getCurrentSyncStatus(@Request() req: AuthRequest) {
    return this.dashboardService.getCurrentSyncStatus(req.user.tenantId);
  }
}
