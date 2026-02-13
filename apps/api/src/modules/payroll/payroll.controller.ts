import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { ReconciliationService } from './services/reconciliation.service';
import { AnomalyDetectorService } from './services/anomaly-detector.service';
import { AnomalyExplainerService } from './services/anomaly-explainer.service';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { PayrollQueryDto, AnomalyQueryDto } from './dto/payroll-query.dto';
import { ResolveAnomalyDto } from './dto/resolve-anomaly.dto';
import { ExportReportDto } from './dto/export-report.dto';

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly anomalyDetector: AnomalyDetectorService,
    private readonly anomalyExplainer: AnomalyExplainerService,
  ) {}

  // ─── Create Payroll Run ─────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a payroll run and import line items' })
  @HttpCode(HttpStatus.CREATED)
  async createPayrollRun(
    @Body() dto: CreatePayrollDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reconciliation.createPayrollRun(req.user.tenantId, dto);
  }

  // ─── List Payroll Runs ──────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List payroll runs (paginated)' })
  async listPayrollRuns(
    @Query() query: PayrollQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reconciliation.listRuns(req.user.tenantId, query);
  }

  // ─── Run Pre-Payroll Reconciliation Check ───────────────────

  @Post(':id/check')
  @ApiOperation({ summary: 'Run pre-payroll reconciliation check' })
  @HttpCode(HttpStatus.OK)
  async runCheck(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reconciliation.runCheck(id, req.user.tenantId);
  }

  // ─── Get Reconciliation Report ──────────────────────────────

  @Get(':id/report')
  @ApiOperation({ summary: 'Get reconciliation report for a payroll run' })
  async getReport(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reconciliation.getReport(id, req.user.tenantId);
  }

  // ─── List Anomalies (Paginated + Filtered) ─────────────────

  @Get(':id/anomalies')
  @ApiOperation({ summary: 'List anomalies for a payroll run (paginated, filterable)' })
  async listAnomalies(
    @Param('id') id: string,
    @Query() query: AnomalyQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reconciliation.listAnomalies(id, req.user.tenantId, query);
  }

  // ─── Resolve Anomaly ───────────────────────────────────────

  @Patch(':id/anomalies/:anomalyId')
  @ApiOperation({ summary: 'Resolve an anomaly with resolution notes' })
  async resolveAnomaly(
    @Param('id') id: string,
    @Param('anomalyId') anomalyId: string,
    @Body() dto: ResolveAnomalyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.reconciliation.resolveAnomaly(
      id,
      anomalyId,
      req.user.tenantId,
      req.user.userId,
      dto.resolutionNotes,
    );
  }

  // ─── Export Report ─────────────────────────────────────────

  @Get(':id/export')
  @ApiOperation({ summary: 'Export reconciliation report as CSV or PDF' })
  async exportReport(
    @Param('id') id: string,
    @Query() query: ExportReportDto,
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ) {
    const format = query.format ?? 'csv';
    const result = await this.reconciliation.exportReport(id, req.user.tenantId, format);

    return reply
      .header('Content-Type', result.contentType)
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.content);
  }

  // ─── AI Anomaly Explanation ─────────────────────────────

  @Post(':id/anomalies/:anomalyId/explain')
  @ApiOperation({ summary: 'Generate AI explanation for an anomaly' })
  @HttpCode(HttpStatus.OK)
  async explainAnomaly(
    @Param('id') _id: string,
    @Param('anomalyId') anomalyId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.anomalyExplainer.explainAnomaly(
      anomalyId,
      req.user.tenantId,
      req.user.userId,
    );
  }

  @Get(':id/anomalies/:anomalyId/explanation')
  @ApiOperation({ summary: 'Get cached AI explanation for an anomaly' })
  async getExplanation(
    @Param('id') _id: string,
    @Param('anomalyId') anomalyId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.anomalyExplainer.getExplanation(anomalyId, req.user.tenantId);
  }

  @Post(':id/anomalies/explain-batch')
  @ApiOperation({ summary: 'Batch explain multiple anomalies' })
  @HttpCode(HttpStatus.OK)
  async explainBatch(
    @Param('id') _id: string,
    @Body() body: { anomalyIds: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.anomalyExplainer.explainBatch(
      body.anomalyIds,
      req.user.tenantId,
      req.user.userId,
    );
  }

  // ─── Legacy: Direct Anomaly Detection ──────────────────────

  @Post(':runId/detect-anomalies')
  @ApiOperation({ summary: 'Run anomaly detection on a payroll run (legacy)' })
  @HttpCode(HttpStatus.OK)
  async detectAnomalies(
    @Param('runId') runId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.anomalyDetector.detectAnomalies(runId, req.user.tenantId);
  }
}

