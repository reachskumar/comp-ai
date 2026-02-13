import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { BudgetDriftService } from './services/monitors/budget-drift.service';
import { PolicyViolationService } from './services/monitors/policy-violation.service';
import { OutlierDetectorService } from './services/monitors/outlier-detector.service';
import { ExecSummaryService } from './services/monitors/exec-summary.service';
import { MonitorSchedulerService } from './services/monitors/monitor-scheduler.service';
import { MonitorAlertQueryDto, TriggerMonitorDto } from './dto';
import { DatabaseService } from '../../database';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('cycle-monitors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('cycles/:cycleId/monitors')
export class MonitorsController {
  constructor(
    private readonly budgetDrift: BudgetDriftService,
    private readonly policyViolation: PolicyViolationService,
    private readonly outlierDetector: OutlierDetectorService,
    private readonly execSummary: ExecSummaryService,
    private readonly scheduler: MonitorSchedulerService,
    private readonly db: DatabaseService,
  ) {}

  // ─── Alerts ──────────────────────────────────────────────────────────

  @Get('alerts')
  @ApiOperation({ summary: 'List monitor alerts for a cycle' })
  async listAlerts(
    @Param('cycleId') cycleId: string,
    @Query() query: MonitorAlertQueryDto,
    @Request() req: AuthRequest,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      tenantId: req.user.tenantId,
      metadata: { path: ['cycleId'], equals: cycleId },
    };

    if (query.alertType) {
      where['type'] = query.alertType;
    }

    // Filter by severity in metadata
    const notifications = await this.db.client.notification.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    const total = await this.db.client.notification.count({ where });

    // Filter by severity if specified (post-filter since it's in metadata)
    const filtered = query.severity
      ? notifications.filter((n) => {
          const meta = n.metadata as Record<string, unknown> | null;
          return meta?.['severity'] === query.severity;
        })
      : notifications;

    return {
      data: filtered,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── Manual Trigger ──────────────────────────────────────────────────

  @Post('run')
  @ApiOperation({ summary: 'Trigger a manual monitor run for a cycle' })
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerRun(
    @Param('cycleId') cycleId: string,
    @Body() dto: TriggerMonitorDto,
    @Request() req: AuthRequest,
  ) {
    return this.scheduler.triggerManualRun(req.user.tenantId, cycleId);
  }

  // ─── Individual Monitors ─────────────────────────────────────────────

  @Get('budget-drift')
  @ApiOperation({ summary: 'Get current budget drift analysis' })
  async getBudgetDrift(
    @Param('cycleId') cycleId: string,
    @Query() dto: TriggerMonitorDto,
    @Request() req: AuthRequest,
  ) {
    return this.budgetDrift.detect(
      req.user.tenantId,
      cycleId,
      dto.driftThresholdPct,
    );
  }

  @Get('policy-violations')
  @ApiOperation({ summary: 'Get current policy violations' })
  async getPolicyViolations(
    @Param('cycleId') cycleId: string,
    @Request() req: AuthRequest,
  ) {
    return this.policyViolation.detect(req.user.tenantId, cycleId);
  }

  @Get('outliers')
  @ApiOperation({ summary: 'Get current outlier analysis' })
  async getOutliers(
    @Param('cycleId') cycleId: string,
    @Request() req: AuthRequest,
  ) {
    return this.outlierDetector.detect(req.user.tenantId, cycleId);
  }

  @Get('exec-summary')
  @ApiOperation({ summary: 'Generate executive summary' })
  async getExecSummary(
    @Param('cycleId') cycleId: string,
    @Request() req: AuthRequest,
  ) {
    return this.execSummary.generate(req.user.tenantId, cycleId);
  }

  @Get('exec-summary/markdown')
  @ApiOperation({ summary: 'Generate executive summary as markdown' })
  async getExecSummaryMarkdown(
    @Param('cycleId') cycleId: string,
    @Request() req: AuthRequest,
  ) {
    const summary = await this.execSummary.generate(
      req.user.tenantId,
      cycleId,
    );
    return { markdown: this.execSummary.toMarkdown(summary) };
  }
}

