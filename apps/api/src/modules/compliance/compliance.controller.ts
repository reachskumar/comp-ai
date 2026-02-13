import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Logger,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { ComplianceService } from './compliance.service';
import { RunScanDto, ScanQueryDto } from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/v1/compliance')
export class ComplianceController {
  private readonly logger = new Logger(ComplianceController.name);

  constructor(private readonly complianceService: ComplianceService) {}

  @Post('scan')
  @ApiOperation({ summary: 'Run a new compliance scan' })
  @HttpCode(HttpStatus.CREATED)
  async runScan(
    @Body() dto: RunScanDto,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, userId } = req.user;
    this.logger.log(`Starting compliance scan: tenant=${tenantId} user=${userId}`);

    const scan = await this.complianceService.createScan(tenantId, userId, dto.scanConfig);

    // Run scan asynchronously — return scan ID immediately
    void this.complianceService.runScan(scan.id, tenantId, userId).catch((err) => {
      this.logger.error(`Scan ${scan.id} failed`, err);
    });

    return {
      id: scan.id,
      status: scan.status,
      message: 'Compliance scan started. Poll GET /api/v1/compliance/scans/:id for results.',
    };
  }

  @Get('scans')
  @ApiOperation({ summary: 'List past compliance scans' })
  async listScans(
    @Query() query: ScanQueryDto,
    @Request() req: AuthRequest,
  ) {
    const { tenantId } = req.user;
    return this.complianceService.listScans(tenantId, {
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
  }

  @Get('scans/:id')
  @ApiOperation({ summary: 'Get compliance scan results' })
  @ApiParam({ name: 'id', description: 'Scan ID' })
  async getScan(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId } = req.user;
    const scan = await this.complianceService.getScan(id, tenantId);
    if (!scan) {
      throw new NotFoundException(`Scan ${id} not found`);
    }
    return scan;
  }

  @Get('score')
  @ApiOperation({ summary: 'Get current compliance score (from latest completed scan)' })
  async getScore(@Request() req: AuthRequest) {
    const { tenantId } = req.user;
    return this.complianceService.getLatestScore(tenantId);
  }

  @Get('score/history')
  @ApiOperation({ summary: 'Get compliance score history for trend chart' })
  async getScoreHistory(@Request() req: AuthRequest) {
    const { tenantId } = req.user;
    return this.complianceService.getScoreHistory(tenantId);
  }
}

