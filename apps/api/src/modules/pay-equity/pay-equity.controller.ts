import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth';
import { PermissionGuard, RequirePermission, TenantGuard } from '../../common';
import { PayEquityV2Service } from './pay-equity.service';
import { ListPayEquityRunsDto, RunPayEquityAnalysisDto } from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string; name?: string };
}

/**
 * Pay Equity v2 endpoints — auditor-defensible contract.
 *
 * The legacy /api/v1/analytics/pay-equity/* endpoints continue to work
 * unchanged; these new endpoints are the foundation for the workspace
 * shell and the eventual full Pay Equity feature surface.
 */
@ApiTags('pay-equity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@RequirePermission('Pay Equity', 'view')
@Controller('pay-equity')
export class PayEquityController {
  private readonly logger = new Logger(PayEquityController.name);

  constructor(private readonly service: PayEquityV2Service) {}

  @Post('runs')
  @ApiOperation({
    summary:
      'Run a pay equity analysis (statistical regression + envelope with citations + methodology). Persists a PayEquityRun row.',
  })
  @RequirePermission('Pay Equity', 'insert')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async runAnalysis(@Body() dto: RunPayEquityAnalysisDto, @Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    this.logger.log(`Run analysis: tenant=${tenantId} user=${userId}`);
    return this.service.runAnalysis(tenantId, userId, dto);
  }

  @Get('runs')
  @ApiOperation({ summary: 'List historical pay equity runs (newest first).' })
  async listRuns(@Query() query: ListPayEquityRunsDto, @Request() req: AuthRequest) {
    return this.service.listRuns(req.user.tenantId, query);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Get a single pay equity run including its full envelope.' })
  async getRun(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.getRun(req.user.tenantId, id);
  }

  @Get('overview')
  @ApiOperation({
    summary: 'Workspace overview: 4-card status from the latest run + delta vs previous run.',
  })
  async overview(@Request() req: AuthRequest) {
    return this.service.getOverview(req.user.tenantId);
  }
}
