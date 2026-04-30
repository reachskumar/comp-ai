import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth';
import { PermissionGuard, RequirePermission, TenantGuard } from '../../common';
import { PayEquityV2Service } from './pay-equity.service';
import { PEDistributionService } from './pe-distribution.service';
import { REPORT_TYPES, type ReportType } from './report-renderers';
import {
  AskCopilotDto,
  CalculateRemediationDto,
  CreateShareTokenDto,
  CreateSubscriptionDto,
  DecideRemediationDto,
  ForecastProjectionDto,
  ListPayEquityRunsDto,
  PreviewChangeDto,
  RunPayEquityAnalysisDto,
} from './dto';

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

  constructor(
    private readonly service: PayEquityV2Service,
    private readonly distribution: PEDistributionService,
  ) {}

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

  // ─── Phase 2 — Remediate ────────────────────────────────────────────

  @Post('runs/:id/remediations/calculate')
  @ApiOperation({
    summary:
      'Compute proposed adjustments for a parent run. Persists a remediation child PayEquityRun + one PayEquityRemediation row per affected employee (status=PROPOSED). Includes AI-narrated justifications.',
  })
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Pay Equity', 'insert')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async calculateRemediations(
    @Param('id') runId: string,
    @Body() dto: CalculateRemediationDto,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, userId } = req.user;
    return this.service.calculateRemediations(tenantId, runId, dto, userId);
  }

  @Get('runs/:id/remediations')
  @ApiOperation({
    summary: 'List per-employee remediation rows for a remediation run.',
  })
  async listRemediations(@Param('id') runId: string, @Request() req: AuthRequest) {
    return this.service.listRemediations(req.user.tenantId, runId);
  }

  @Patch('remediations/:id/decision')
  @ApiOperation({
    summary: 'Approve or decline a single PROPOSED remediation. Audit-logged.',
  })
  @RequirePermission('Pay Equity', 'update')
  async decideRemediation(
    @Param('id') id: string,
    @Body() dto: DecideRemediationDto,
    @Request() req: AuthRequest,
  ) {
    return this.service.decideRemediation(
      req.user.tenantId,
      id,
      dto.decision,
      req.user.userId,
      dto.note,
    );
  }

  @Post('runs/:id/remediations/apply')
  @ApiOperation({
    summary:
      'Apply all APPROVED remediations on a remediation run: writes Employee.baseSalary, marks each row APPLIED, emits audit log per change.',
  })
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Pay Equity', 'update')
  async applyRemediations(@Param('id') runId: string, @Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    return this.service.applyApprovedRemediations(tenantId, runId, userId);
  }

  // ─── Phase 3 — Report ───────────────────────────────────────────────

  @Get('runs/:id/reports/:type')
  @ApiOperation({
    summary:
      'Download a Pay Equity report artifact (board PDF, EU PTD CSV, UK GPG CSV, EEO-1 CSV, CA SB 1162 CSV, or auditor PDF). Audit-logged per export.',
  })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async downloadReport(
    @Param('id') runId: string,
    @Param('type') type: string,
    @Request() req: AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    if (!REPORT_TYPES.includes(type as ReportType)) {
      throw new BadRequestException(
        `Unknown report type: ${type}. Valid: ${REPORT_TYPES.join(', ')}`,
      );
    }
    const { tenantId, userId } = req.user;
    const { buffer, filename, mimeType } = await this.service.generateReport(
      tenantId,
      runId,
      type as ReportType,
      userId,
    );
    void reply
      .header('Content-Type', mimeType)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', buffer.length)
      .send(buffer);
  }

  // ─── Phase 4 — Predict ──────────────────────────────────────────────

  @Post('projections/forecast')
  @ApiOperation({
    summary:
      'Forecast the worst-cohort gap forward N months. Optional hiring + promotion scenario adjusts the deterministic projection. AI agent narrates drivers + recommended actions. Persists a child PayEquityRun.',
  })
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Pay Equity', 'insert')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async forecastProjection(@Body() dto: ForecastProjectionDto, @Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    return this.service.forecastProjection(tenantId, userId, {
      scenarioLabel: dto.scenarioLabel,
      horizonMonths: dto.horizonMonths,
      hiringPlan: dto.hiringPlan,
      promotionPlan: dto.promotionPlan,
    });
  }

  @Get('runs/:id/air')
  @ApiOperation({
    summary:
      'Adverse Impact Ratio (80% rule) per cohort for a given run. Read-only; no persistence. AIR < 0.8 flags adverse impact.',
  })
  async getAir(@Param('id') runId: string, @Request() req: AuthRequest) {
    return this.service.getAirAnalysis(req.user.tenantId, runId);
  }

  // ─── Phase 5 — Trust ────────────────────────────────────────────────

  @Get('runs/:id/methodology')
  @ApiOperation({
    summary:
      'Methodology snapshot for a run: model+version, controls, sample size, headline stats, child agent invocations, citation count.',
  })
  async getMethodology(@Param('id') runId: string, @Request() req: AuthRequest) {
    return this.service.getMethodology(req.user.tenantId, runId);
  }

  @Get('runs/:id/audit')
  @ApiOperation({
    summary:
      'Audit trail for a run: every PayEquityRun + remediation event linked to this analysis. Read-only.',
  })
  async getAuditTrail(@Param('id') runId: string, @Request() req: AuthRequest) {
    return this.service.getAuditTrail(req.user.tenantId, runId);
  }

  // ─── Phase 6.3 — Manager Equity Copilot ────────────────────────────

  @Post('copilot/ask')
  @ApiOperation({
    summary:
      'Bounded-scope Q&A for managers about their team or the org PE state. Service resolves the manager → team via email, pulls latest narrative run, invokes the copilot LLM agent. Persists a child PayEquityRun.',
  })
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Pay Equity', 'insert')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async askCopilot(@Body() dto: AskCopilotDto, @Request() req: AuthRequest) {
    const { tenantId, userId, email, name } = req.user;
    return this.service.askCopilot(tenantId, userId, { email, name }, dto.question);
  }

  // ─── Phase 4 — Prevent half ──────────────────────────────────────────

  @Get('band-drift')
  @ApiOperation({
    summary:
      'Pay band drift detector: compares mean compa-ratio across recent runs. Falling CR = bands outpacing salaries. Read-only.',
  })
  async getBandDrift(@Request() req: AuthRequest) {
    return this.service.getBandDrift(req.user.tenantId);
  }

  @Post('preview-change')
  @ApiOperation({
    summary:
      'Pre-decision equity check: given hypothetical changes (promotion slate, in-cycle salary change, or new-hire offer), returns projected gap impact + flagged employees + verdict (safe/warn/block). Read-only; deterministic; no LLM. Designed to be called inline from /comp-cycles or a recruiter offer flow.',
  })
  @HttpCode(HttpStatus.OK)
  async previewChange(@Body() dto: PreviewChangeDto, @Request() req: AuthRequest) {
    return this.service.previewChange(req.user.tenantId, dto.changes);
  }

  // ─── Phase 3.7 + 6.4 — Subscriptions ────────────────────────────────

  @Get('subscriptions')
  @ApiOperation({ summary: 'List Pay Equity report subscriptions for this tenant.' })
  async listSubscriptions(@Request() req: AuthRequest) {
    return this.distribution.listSubscriptions(req.user.tenantId);
  }

  @Post('subscriptions')
  @ApiOperation({
    summary:
      'Create a scheduled report subscription. reportType=digest = daily CHRO summary; otherwise the named report is generated and emailed (and optionally posted to Slack for digest).',
  })
  @RequirePermission('Pay Equity', 'insert')
  async createSubscription(@Body() dto: CreateSubscriptionDto, @Request() req: AuthRequest) {
    return this.distribution.createSubscription(req.user.tenantId, req.user.userId, dto);
  }

  @Post('subscriptions/run-due')
  @ApiOperation({
    summary:
      'Cron-style scanner: dispatch every subscription whose nextRunAt is due. Idempotent. Intended to be called by an external scheduler (BullMQ repeat or k8s cron).',
  })
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Pay Equity', 'insert')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async runDueSubscriptions() {
    return this.distribution.runDueSubscriptions();
  }

  @Patch('subscriptions/:id')
  @ApiOperation({ summary: 'Delete a subscription. Audit-logged.' })
  @RequirePermission('Pay Equity', 'update')
  async deleteSubscription(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.distribution.deleteSubscription(req.user.tenantId, id, req.user.userId);
  }

  // ─── Phase 5.5 — Share tokens ──────────────────────────────────────

  @Get('share-tokens')
  @ApiOperation({ summary: 'List Pay Equity auditor share tokens for this tenant.' })
  async listShareTokens(@Request() req: AuthRequest) {
    return this.distribution.listShareTokens(req.user.tenantId);
  }

  @Post('share-tokens')
  @ApiOperation({
    summary:
      'Mint a share token bound to a single PayEquityRun. The token alone authenticates the public /pe-share/:token route — no tenant account needed for the auditor.',
  })
  @RequirePermission('Pay Equity', 'insert')
  async createShareToken(@Body() dto: CreateShareTokenDto, @Request() req: AuthRequest) {
    return this.distribution.createShareToken(req.user.tenantId, req.user.userId, dto);
  }

  @Patch('share-tokens/:id/revoke')
  @ApiOperation({ summary: 'Revoke a share token. Subsequent redemptions return 400.' })
  @RequirePermission('Pay Equity', 'update')
  async revokeShareToken(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.distribution.revokeShareToken(req.user.tenantId, id, req.user.userId);
  }

  // ─── Phase 2.4 — Multi-quarter plan ─────────────────────────────────

  @Get('runs/:id/remediations/phase')
  @ApiOperation({
    summary:
      "Phase 2.4: split a remediation run's PROPOSED+APPROVED rows into N quarter buckets, biggest deltas first. Read-only; no persistence — caller can apply per-quarter via the existing decide + apply endpoints.",
  })
  async phaseRemediations(
    @Param('id') runId: string,
    @Request() req: AuthRequest,
    @Query('quarters') quartersStr?: string,
  ) {
    const quarters = quartersStr ? parseInt(quartersStr, 10) : 4;
    return this.service.phaseRemediations(req.user.tenantId, runId, quarters);
  }

  // ─── Phase 2.6 — Letters hook ───────────────────────────────────────

  @Post('runs/:id/remediations/letters')
  @ApiOperation({
    summary:
      'Phase 2.6: stage a CompensationLetter (DRAFT) for every APPLIED remediation in a run. Lets the existing /letters dashboard own delivery; this just creates the rows linked back to the remediation.',
  })
  @HttpCode(HttpStatus.OK)
  @RequirePermission('Pay Equity', 'insert')
  async stageRemediationLetters(@Param('id') runId: string, @Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    return this.service.stageRemediationLetters(tenantId, runId, userId);
  }

  // ─── Phase 6.1 — Employee statement ─────────────────────────────────

  @Get('runs/:id/employee-statement/:employeeId')
  @ApiOperation({
    summary:
      "Phase 6.1: per-employee personal equity statement. Privacy-aware PDF showing the employee's compa-ratio in context (mid-band / range), no peer salaries shown.",
  })
  async getEmployeeStatement(
    @Param('id') runId: string,
    @Param('employeeId') employeeId: string,
    @Request() req: AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    const { tenantId, userId } = req.user;
    const { buffer, filename, mimeType } = await this.service.generateReport(
      tenantId,
      runId,
      'employee_statement',
      userId,
      { employeeId },
    );
    void reply
      .header('Content-Type', mimeType)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', buffer.length)
      .send(buffer);
  }

  // ─── Phase 6.2 — Pay range publication ──────────────────────────────

  @Get('pay-ranges')
  @ApiOperation({
    summary:
      "Phase 6.2: tenant's pay ranges (per jobFamily/level/location). Read-only feed for jurisdictions that mandate range publication (CA SB 1162, NY Local Law 32, CO Equal Pay, EU PTD).",
  })
  async getPayRanges(@Request() req: AuthRequest) {
    return this.service.getPayRanges(req.user.tenantId);
  }
}
