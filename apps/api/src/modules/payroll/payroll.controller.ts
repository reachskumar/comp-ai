import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { AnomalyDetectorService } from './services/anomaly-detector.service';

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('payroll')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly anomalyDetector: AnomalyDetectorService,
  ) {}

  @Post(':runId/detect-anomalies')
  @ApiOperation({ summary: 'Run anomaly detection on a payroll run' })
  @HttpCode(HttpStatus.OK)
  async detectAnomalies(
    @Param('runId') runId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.anomalyDetector.detectAnomalies(runId, req.user.tenantId);
  }

  @Get(':runId/anomalies')
  @ApiOperation({ summary: 'Get anomalies for a payroll run' })
  async getAnomalies(
    @Param('runId') runId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    // Verify tenant access by loading the run
    const run = await this.anomalyDetector['db'].client.payrollRun.findFirst({
      where: { id: runId, tenantId: req.user.tenantId },
    });
    if (!run) {
      throw new Error(`PayrollRun ${runId} not found`);
    }

    const anomalies = await this.anomalyDetector['db'].client.payrollAnomaly.findMany({
      where: { payrollRunId: runId },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });

    return { payrollRunId: runId, anomalies };
  }
}

