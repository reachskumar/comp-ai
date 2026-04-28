import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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

  // ─── Phase 1 — Diagnose ─────────────────────────────────────────────

  @Get('trend')
  @ApiOperation({
    summary: 'Time series of gaps across the last N runs (oldest→newest).',
  })
  async getTrend(
    @Request() req: AuthRequest,
    @Query('dimension') dimension?: string,
    @Query('limit') limitStr?: string,
  ) {
    return this.service.getTrend(req.user.tenantId, {
      dimension: dimension || undefined,
      limit: limitStr ? parseInt(limitStr, 10) : undefined,
    });
  }

  @Get('runs/:id/cohorts')
  @ApiOperation({
    summary: 'Cohort matrix from a single run — heatmap-friendly cell array.',
  })
  async getCohorts(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.getCohorts(req.user.tenantId, id);
  }

  @Get('runs/:id/cohorts/:dimension/:group')
  @ApiOperation({
    summary: 'Drill into a specific cohort — employee rows + statistical test.',
  })
  async getCohortDetail(
    @Param('id') id: string,
    @Param('dimension') dimension: string,
    @Param('group') group: string,
    @Request() req: AuthRequest,
    @Query('limit') limitStr?: string,
  ) {
    return this.service.getCohortDetail(
      req.user.tenantId,
      id,
      dimension,
      decodeURIComponent(group),
      { limit: limitStr ? parseInt(limitStr, 10) : undefined },
    );
  }

  @Get('runs/:id/outliers')
  @ApiOperation({
    summary: 'Lowest-compaRatio outliers within statistically-significant cohorts.',
  })
  async getOutliers(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Query('dimension') dimension?: string,
    @Query('limit') limitStr?: string,
  ) {
    return this.service.getOutliers(req.user.tenantId, id, {
      dimension: dimension || undefined,
      limit: limitStr ? parseInt(limitStr, 10) : undefined,
    });
  }

  // ─── Phase 1.5 — AI agents ──────────────────────────────────────────

  @Post('runs/:id/cohorts/:dimension/:group/root-cause')
  @ApiOperation({
    summary:
      'Run the cohort root-cause AI agent on a cohort cell. Persists a child PayEquityRun row.',
  })
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Pay Equity', 'insert')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async analyzeCohortRootCause(
    @Param('id') runId: string,
    @Param('dimension') dimension: string,
    @Param('group') group: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, userId } = req.user;
    return this.service.analyzeCohortRootCause(
      tenantId,
      runId,
      dimension,
      decodeURIComponent(group),
      userId,
    );
  }

  @Post('runs/:id/outliers/:employeeId/explain')
  @ApiOperation({
    summary:
      'Run the outlier explainer AI agent for a single employee. Persists a child PayEquityRun row.',
  })
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Pay Equity', 'insert')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async explainOutlier(
    @Param('id') runId: string,
    @Param('employeeId') employeeId: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, userId } = req.user;
    return this.service.explainOutlier(tenantId, runId, employeeId, userId);
  }
}
