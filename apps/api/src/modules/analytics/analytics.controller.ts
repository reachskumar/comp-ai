import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Body,
  Param,
  Res,
  UseGuards,
  Request,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard, PermissionGuard, RequirePermission } from '../../common';
import { TotalRewardsService } from './total-rewards.service';
import { PayEquityService } from './pay-equity.service';
import { SimulationService } from './simulation.service';
import { HrDashboardService } from './hr-dashboard.service';
import { EdgeRegressionService } from './edge-regression.service';
import {
  TotalRewardsQueryDto,
  TotalRewardsView,
  PayEquityAnalyzeDto,
  RemediationSimulateDto,
  RunSimulationDto,
  CompareSimulationsDto,
  RunEdgeAnalysisDto,
} from './dto';
import { formatSSE } from '@compensation/ai';
import { FastifyReply } from 'fastify';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly totalRewardsService: TotalRewardsService,
    private readonly payEquityService: PayEquityService,
    private readonly simulationService: SimulationService,
    private readonly hrDashboardService: HrDashboardService,
    private readonly edgeService: EdgeRegressionService,
  ) {}

  /* ─── HR Dashboard Endpoint ─────────────────────────────── */

  @Get('hr-dashboard')
  @ApiOperation({ summary: 'Get HR dashboard stats: headcount, salary distribution, etc.' })
  async getHrDashboard(@Request() req: AuthRequest) {
    this.logger.log(`HR Dashboard request: user=${req.user.userId}`);
    return this.hrDashboardService.getDashboard(req.user.tenantId, req.user.userId, req.user.role);
  }

  @Get('total-rewards')
  @ApiOperation({ summary: 'Get total rewards statement for the authenticated user' })
  async getTotalRewards(@Query() query: TotalRewardsQueryDto, @Request() req: AuthRequest) {
    this.logger.log(
      `Total rewards request: user=${req.user.userId} view=${query.view || 'personal'}`,
    );

    if (query.view === TotalRewardsView.TEAM) {
      return this.totalRewardsService.getTeamOverview(
        req.user.tenantId,
        req.user.userId,
        req.user.role,
      );
    }

    return this.totalRewardsService.getPersonalRewards(
      req.user.tenantId,
      req.user.userId,
      query.year,
    );
  }

  /* ─── Pay Equity Endpoints ──────────────────────────────── */

  @Post('pay-equity/analyze')
  @ApiOperation({ summary: 'Run pay equity analysis across demographic dimensions' })
  async analyzePayEquity(@Body() dto: PayEquityAnalyzeDto, @Request() req: AuthRequest) {
    this.logger.log(
      `Pay equity analysis: user=${req.user.userId} dimensions=${dto.dimensions.join(',')}`,
    );

    return this.payEquityService.analyze(req.user.tenantId, req.user.userId, {
      dimensions: dto.dimensions,
      controlVariables: dto.controlVariables,
      targetThreshold: dto.targetThreshold,
    });
  }

  @Get('pay-equity/report/:id')
  @ApiOperation({ summary: 'Get a previously generated pay equity report' })
  async getPayEquityReport(@Param('id') reportId: string, @Request() req: AuthRequest) {
    const report = await this.payEquityService.getReport(req.user.tenantId, reportId);

    if (!report) {
      throw new NotFoundException(`Pay equity report ${reportId} not found`);
    }

    return report;
  }

  @Post('pay-equity/report/:id/simulate')
  @ApiOperation({ summary: 'Simulate remediation adjustments for a pay equity report' })
  async simulateRemediation(
    @Param('id') reportId: string,
    @Body() dto: RemediationSimulateDto,
    @Request() req: AuthRequest,
  ) {
    this.logger.log(
      `Remediation simulation: report=${reportId} adjustment=${dto.adjustmentPercent}%`,
    );

    return this.payEquityService.simulateRemediation(
      req.user.tenantId,
      reportId,
      dto.adjustmentPercent,
      dto.targetGroups,
    );
  }

  /* ─── Simulation Endpoints ─────────────────────────────── */

  @Post('simulate')
  @ApiOperation({ summary: 'Run a compensation simulation from a natural language prompt' })
  async runSimulation(@Body() dto: RunSimulationDto, @Request() req: AuthRequest) {
    this.logger.log(`Simulation: user=${req.user.userId} prompt="${dto.prompt.slice(0, 80)}"`);
    return this.simulationService.runSimulation(
      req.user.tenantId,
      req.user.userId,
      dto.prompt,
      req.user.role,
    );
  }

  @Post('simulate/stream')
  @ApiOperation({ summary: 'Stream a compensation simulation via SSE' })
  async streamSimulation(
    @Body() dto: RunSimulationDto,
    @Request() req: AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    this.logger.log(`Simulation stream: user=${req.user.userId}`);
    const simOrigin = reply.request.headers.origin;
    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(simOrigin
        ? {
            'Access-Control-Allow-Origin': simOrigin,
            'Access-Control-Allow-Credentials': 'true',
          }
        : {}),
    });

    try {
      for await (const event of this.simulationService.streamSimulation(
        req.user.tenantId,
        req.user.userId,
        dto.prompt,
        req.user.role,
      )) {
        reply.raw.write(formatSSE(event));
      }
    } catch (error) {
      this.logger.error('Simulation stream error', error);
      reply.raw.write(
        formatSSE({
          event: 'error',
          data: {
            message: error instanceof Error ? error.message : 'Internal error',
            timestamp: Date.now(),
          },
        }),
      );
    } finally {
      reply.raw.end();
    }
  }

  @Post('simulate/compare')
  @ApiOperation({ summary: 'Compare two compensation simulation scenarios side-by-side' })
  async compareSimulations(@Body() dto: CompareSimulationsDto, @Request() req: AuthRequest) {
    this.logger.log(`Simulation compare: user=${req.user.userId}`);
    return this.simulationService.compareSimulations(
      req.user.tenantId,
      req.user.userId,
      dto.promptA,
      dto.promptB,
      req.user.role,
    );
  }

  @Get('simulate/history')
  @ApiOperation({ summary: 'Get simulation scenario history for the current user' })
  async getSimulationHistory(@Request() req: AuthRequest) {
    return this.simulationService.getScenarioHistory(req.user.tenantId, req.user.userId);
  }

  /* ─── EDGE Pay Equity Endpoints ──────────────────────────── */

  @Post('pay-equity/edge/analyze')
  @RequirePermission('Analytics/Reports', 'insert')
  @ApiOperation({
    summary: 'Run EDGE-compliant pay equity analysis (Standard or Customized)',
  })
  async runEdgeAnalysis(@Body() dto: RunEdgeAnalysisDto, @Request() req: AuthRequest) {
    this.logger.log(
      `EDGE analysis: user=${req.user.userId} type=${dto.analysisType} name="${dto.name}"`,
    );

    // Run dual analysis: Salary (base) + Pay (base + bonus)
    const [salaryResult, payResult] = await Promise.all([
      this.edgeService.analyze(req.user.tenantId, {
        type: dto.analysisType,
        compType: 'SALARY',
        name: dto.name,
        additionalPredictors: dto.customVariables,
      }),
      this.edgeService.analyze(req.user.tenantId, {
        type: dto.analysisType,
        compType: 'PAY',
        name: dto.name,
        additionalPredictors: dto.customVariables,
      }),
    ]);

    // Determine overall compliance (both must pass)
    const passesEdgeStandard = salaryResult.overall.isCompliant && payResult.overall.isCompliant;

    // Calculate threshold
    const threshold = this.edgeService.calculateThreshold({
      type: dto.analysisType,
      compType: 'SALARY',
      name: dto.name,
      additionalPredictors: dto.customVariables,
    });

    // Build EDGE summary statistics (Table 2 from methodology)
    const summaryStatistics = {
      analysisType: dto.analysisType,
      analysisName: dto.name,
      threshold,
      salary: {
        observations: salaryResult.populationSize,
        maleCount: salaryResult.overall.maleCount,
        femaleCount: salaryResult.overall.femaleCount,
        predictorCount: salaryResult.overall.coefficients.length,
        adjustedRSquared: salaryResult.overall.adjustedRSquared,
        genderCoefficient:
          salaryResult.overall.coefficients.find((c) => c.name === 'gender_female')?.value ?? null,
        genderEffect: salaryResult.overall.genderEffect,
        isCompliant: salaryResult.overall.isCompliant,
      },
      pay: {
        observations: payResult.populationSize,
        maleCount: payResult.overall.maleCount,
        femaleCount: payResult.overall.femaleCount,
        predictorCount: payResult.overall.coefficients.length,
        adjustedRSquared: payResult.overall.adjustedRSquared,
        genderCoefficient:
          payResult.overall.coefficients.find((c) => c.name === 'gender_female')?.value ?? null,
        genderEffect: payResult.overall.genderEffect,
        isCompliant: payResult.overall.isCompliant,
      },
    };

    // Persist both reports to DB
    const [salaryReportId, payReportId] = await Promise.all([
      this.edgeService.persistReport(req.user.tenantId, req.user.userId, salaryResult),
      this.edgeService.persistReport(req.user.tenantId, req.user.userId, payResult),
    ]);

    return {
      salaryReportId,
      payReportId,
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      analysisType: dto.analysisType,
      name: dto.name,
      snapshotDate: salaryResult.snapshotDate,
      passesEdgeStandard,
      summaryStatistics,
      salaryAnalysis: salaryResult,
      payAnalysis: payResult,
      errors: [...salaryResult.errors, ...payResult.errors],
    };
  }

  @Post('pay-equity/edge/analyze/stream')
  @RequirePermission('Analytics/Reports', 'insert')
  @ApiOperation({ summary: 'Run EDGE analysis with real-time SSE progress streaming' })
  async runEdgeAnalysisStream(
    @Body() dto: RunEdgeAnalysisDto,
    @Request() req: AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    const edgeOrigin = reply.request.headers.origin;
    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(edgeOrigin
        ? {
            'Access-Control-Allow-Origin': edgeOrigin,
            'Access-Control-Allow-Credentials': 'true',
          }
        : {}),
    });

    const emit = (step: string, pct: number) => {
      reply.raw.write(
        formatSSE({ event: 'progress:step', data: { step, percent: pct, timestamp: Date.now() } }),
      );
    };

    try {
      reply.raw.write(
        formatSSE({ event: 'progress:start', data: { name: dto.name, timestamp: Date.now() } }),
      );

      emit('Fetching employees…', 10);
      // Pre-fetch employees (single DB call, used by both analyses)
      const threshold = this.edgeService.calculateThreshold({
        type: dto.analysisType,
        compType: 'SALARY',
        name: dto.name,
        additionalPredictors: dto.customVariables,
      });

      emit('Running Salary regression…', 25);
      const salaryResult = await this.edgeService.analyze(req.user.tenantId, {
        type: dto.analysisType,
        compType: 'SALARY',
        name: dto.name,
        additionalPredictors: dto.customVariables,
      });

      emit('Running Pay regression…', 50);
      const payResult = await this.edgeService.analyze(req.user.tenantId, {
        type: dto.analysisType,
        compType: 'PAY',
        name: dto.name,
        additionalPredictors: dto.customVariables,
      });

      emit('Running dimension breakdowns…', 70);
      const passesEdgeStandard = salaryResult.overall.isCompliant && payResult.overall.isCompliant;

      const summaryStatistics = {
        analysisType: dto.analysisType,
        analysisName: dto.name,
        threshold,
        salary: {
          observations: salaryResult.populationSize,
          maleCount: salaryResult.overall.maleCount,
          femaleCount: salaryResult.overall.femaleCount,
          predictorCount: salaryResult.overall.coefficients.length,
          adjustedRSquared: salaryResult.overall.adjustedRSquared,
          genderCoefficient:
            salaryResult.overall.coefficients.find((c) => c.name === 'gender_female')?.value ??
            null,
          genderEffect: salaryResult.overall.genderEffect,
          isCompliant: salaryResult.overall.isCompliant,
        },
        pay: {
          observations: payResult.populationSize,
          maleCount: payResult.overall.maleCount,
          femaleCount: payResult.overall.femaleCount,
          predictorCount: payResult.overall.coefficients.length,
          adjustedRSquared: payResult.overall.adjustedRSquared,
          genderCoefficient:
            payResult.overall.coefficients.find((c) => c.name === 'gender_female')?.value ?? null,
          genderEffect: payResult.overall.genderEffect,
          isCompliant: payResult.overall.isCompliant,
        },
      };

      emit('Persisting reports…', 85);
      const [salaryReportId, payReportId] = await Promise.all([
        this.edgeService.persistReport(req.user.tenantId, req.user.userId, salaryResult),
        this.edgeService.persistReport(req.user.tenantId, req.user.userId, payResult),
      ]);

      emit('Complete', 100);

      const result = {
        salaryReportId,
        payReportId,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
        analysisType: dto.analysisType,
        name: dto.name,
        snapshotDate: salaryResult.snapshotDate,
        passesEdgeStandard,
        summaryStatistics,
        salaryAnalysis: salaryResult,
        payAnalysis: payResult,
        errors: [...salaryResult.errors, ...payResult.errors],
      };

      reply.raw.write(
        formatSSE({ event: 'progress:result', data: result as unknown as Record<string, unknown> }),
      );
    } catch (error) {
      this.logger.error('EDGE analysis stream error', error);
      reply.raw.write(
        formatSSE({
          event: 'progress:error',
          data: {
            message: error instanceof Error ? error.message : 'Analysis failed',
            timestamp: Date.now(),
          },
        }),
      );
    } finally {
      reply.raw.end();
    }
  }

  @Get('pay-equity/edge/reports')
  @RequirePermission('Analytics/Reports', 'view')
  @ApiOperation({ summary: 'List EDGE pay equity reports for the current tenant' })
  async listEdgeReports(
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Request() req: AuthRequest,
  ) {
    return this.edgeService.listReports(req.user.tenantId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('pay-equity/edge/reports/:id')
  @RequirePermission('Analytics/Reports', 'view')
  @ApiOperation({ summary: 'Get a single EDGE pay equity report with dimension breakdowns' })
  async getEdgeReport(@Param('id') id: string, @Request() req: AuthRequest) {
    const report = await this.edgeService.getReport(req.user.tenantId, id);
    if (!report) throw new NotFoundException(`EDGE report ${id} not found`);
    return report;
  }

  @Patch('pay-equity/edge/reports/:id')
  @RequirePermission('Analytics/Reports', 'update')
  @ApiOperation({ summary: 'Rename an EDGE pay equity report' })
  async updateEdgeReport(
    @Param('id') id: string,
    @Body() body: { name: string },
    @Request() req: AuthRequest,
  ) {
    const report = await this.edgeService.updateReport(req.user.tenantId, id, { name: body.name });
    if (!report) throw new NotFoundException(`EDGE report ${id} not found`);
    return report;
  }

  @Delete('pay-equity/edge/reports/:id')
  @RequirePermission('Analytics/Reports', 'delete')
  @ApiOperation({ summary: 'Delete an EDGE pay equity report and its dimension breakdowns' })
  async deleteEdgeReport(@Param('id') id: string, @Request() req: AuthRequest) {
    const deleted = await this.edgeService.deleteReport(req.user.tenantId, id);
    if (!deleted) throw new NotFoundException(`EDGE report ${id} not found`);
    return { success: true };
  }
}
