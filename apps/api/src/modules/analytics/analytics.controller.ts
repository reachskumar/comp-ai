import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Param,
  Res,
  UseGuards,
  Request,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
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
@UseGuards(JwtAuthGuard, TenantGuard)
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
    return this.hrDashboardService.getDashboard(req.user.tenantId);
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
    return this.simulationService.runSimulation(req.user.tenantId, req.user.userId, dto.prompt);
  }

  @Post('simulate/stream')
  @ApiOperation({ summary: 'Stream a compensation simulation via SSE' })
  async streamSimulation(
    @Body() dto: RunSimulationDto,
    @Request() req: AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    this.logger.log(`Simulation stream: user=${req.user.userId}`);
    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const event of this.simulationService.streamSimulation(
        req.user.tenantId,
        req.user.userId,
        dto.prompt,
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
    );
  }

  @Get('simulate/history')
  @ApiOperation({ summary: 'Get simulation scenario history for the current user' })
  async getSimulationHistory(@Request() req: AuthRequest) {
    return this.simulationService.getScenarioHistory(req.user.tenantId, req.user.userId);
  }

  /* ─── EDGE Pay Equity Endpoints ──────────────────────────── */

  @Post('pay-equity/edge/analyze')
  @ApiOperation({
    summary: 'Run EDGE-compliant pay equity analysis (Standard or Customized)',
  })
  async runEdgeAnalysis(@Body() dto: RunEdgeAnalysisDto, @Request() req: AuthRequest) {
    const allowedRoles = ['ADMIN', 'HR_MANAGER', 'ANALYST', 'PLATFORM_ADMIN'];
    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenException('Only ADMIN, HR_MANAGER, or ANALYST can run EDGE analyses');
    }

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

  @Get('pay-equity/edge/reports')
  @ApiOperation({ summary: 'List EDGE pay equity reports for the current tenant' })
  async listEdgeReports(
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Request() req: AuthRequest,
  ) {
    const allowedRoles = ['ADMIN', 'HR_MANAGER', 'ANALYST', 'PLATFORM_ADMIN'];
    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenException('Only ADMIN, HR_MANAGER, or ANALYST can view EDGE reports');
    }
    return this.edgeService.listReports(req.user.tenantId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('pay-equity/edge/reports/:id')
  @ApiOperation({ summary: 'Get a single EDGE pay equity report with dimension breakdowns' })
  async getEdgeReport(@Param('id') id: string, @Request() req: AuthRequest) {
    const allowedRoles = ['ADMIN', 'HR_MANAGER', 'ANALYST', 'PLATFORM_ADMIN'];
    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenException('Only ADMIN, HR_MANAGER, or ANALYST can view EDGE reports');
    }
    const report = await this.edgeService.getReport(req.user.tenantId, id);
    if (!report) throw new NotFoundException(`EDGE report ${id} not found`);
    return report;
  }
}
