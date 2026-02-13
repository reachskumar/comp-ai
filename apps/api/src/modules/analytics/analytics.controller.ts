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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { TotalRewardsService } from './total-rewards.service';
import { PayEquityService } from './pay-equity.service';
import { SimulationService } from './simulation.service';
import {
  TotalRewardsQueryDto,
  TotalRewardsView,
  PayEquityAnalyzeDto,
  RemediationSimulateDto,
  RunSimulationDto,
  CompareSimulationsDto,
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
  ) {}

  @Get('total-rewards')
  @ApiOperation({ summary: 'Get total rewards statement for the authenticated user' })
  async getTotalRewards(
    @Query() query: TotalRewardsQueryDto,
    @Request() req: AuthRequest,
  ) {
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
  async analyzePayEquity(
    @Body() dto: PayEquityAnalyzeDto,
    @Request() req: AuthRequest,
  ) {
    this.logger.log(
      `Pay equity analysis: user=${req.user.userId} dimensions=${dto.dimensions.join(',')}`,
    );

    return this.payEquityService.analyze(
      req.user.tenantId,
      req.user.userId,
      {
        dimensions: dto.dimensions,
        controlVariables: dto.controlVariables,
        targetThreshold: dto.targetThreshold,
      },
    );
  }

  @Get('pay-equity/report/:id')
  @ApiOperation({ summary: 'Get a previously generated pay equity report' })
  async getPayEquityReport(
    @Param('id') reportId: string,
    @Request() req: AuthRequest,
  ) {
    const report = await this.payEquityService.getReport(
      req.user.tenantId,
      reportId,
    );

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
  async runSimulation(
    @Body() dto: RunSimulationDto,
    @Request() req: AuthRequest,
  ) {
    this.logger.log(`Simulation: user=${req.user.userId} prompt="${dto.prompt.slice(0, 80)}"`);
    return this.simulationService.runSimulation(
      req.user.tenantId,
      req.user.userId,
      dto.prompt,
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
  async compareSimulations(
    @Body() dto: CompareSimulationsDto,
    @Request() req: AuthRequest,
  ) {
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
    return this.simulationService.getScenarioHistory(
      req.user.tenantId,
      req.user.userId,
    );
  }
}

