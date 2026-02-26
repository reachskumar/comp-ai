import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
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
import { BenchmarkingService } from './benchmarking.service';
import {
  CreateSalaryBandDto,
  UpdateSalaryBandDto,
  BulkImportSalaryBandsDto,
  SalaryBandQueryDto,
  CreateMarketDataSourceDto,
  UpdateMarketDataSourceDto,
} from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('benchmarking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('benchmarking')
export class BenchmarkingController {
  constructor(private readonly benchmarkingService: BenchmarkingService) {}

  // ─── Salary Bands CRUD ────────────────────────────────────────

  @Get('bands')
  @ApiOperation({ summary: 'List salary bands with filters' })
  async listBands(@Query() query: SalaryBandQueryDto, @Request() req: AuthRequest) {
    return this.benchmarkingService.listBands(req.user.tenantId, query);
  }

  @Post('bands')
  @ApiOperation({ summary: 'Create a salary band' })
  @HttpCode(HttpStatus.CREATED)
  async createBand(@Body() dto: CreateSalaryBandDto, @Request() req: AuthRequest) {
    return this.benchmarkingService.createBand(req.user.tenantId, dto);
  }

  @Put('bands/:id')
  @ApiOperation({ summary: 'Update a salary band' })
  async updateBand(
    @Param('id') id: string,
    @Body() dto: UpdateSalaryBandDto,
    @Request() req: AuthRequest,
  ) {
    return this.benchmarkingService.updateBand(req.user.tenantId, id, dto);
  }

  @Delete('bands/:id')
  @ApiOperation({ summary: 'Delete a salary band' })
  async deleteBand(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.benchmarkingService.deleteBand(req.user.tenantId, id);
  }

  @Post('bands/import')
  @ApiOperation({ summary: 'Bulk import salary bands from CSV/JSON' })
  @HttpCode(HttpStatus.CREATED)
  async bulkImportBands(@Body() dto: BulkImportSalaryBandsDto, @Request() req: AuthRequest) {
    return this.benchmarkingService.bulkImportBands(req.user.tenantId, dto.bands);
  }

  // ─── Analysis ─────────────────────────────────────────────────

  @Get('analysis')
  @ApiOperation({ summary: 'Compa-ratio analysis: employees vs salary bands' })
  async getAnalysis(@Request() req: AuthRequest) {
    return this.benchmarkingService.getAnalysis(req.user.tenantId);
  }

  // ─── Market Data Sources ──────────────────────────────────────

  @Get('sources')
  @ApiOperation({ summary: 'List market data sources' })
  async listSources(@Request() req: AuthRequest) {
    return this.benchmarkingService.listSources(req.user.tenantId);
  }

  @Post('sources')
  @ApiOperation({ summary: 'Add a market data source' })
  @HttpCode(HttpStatus.CREATED)
  async createSource(@Body() dto: CreateMarketDataSourceDto, @Request() req: AuthRequest) {
    return this.benchmarkingService.createSource(req.user.tenantId, dto);
  }

  @Put('sources/:id')
  @ApiOperation({ summary: 'Update a market data source' })
  async updateSource(
    @Param('id') id: string,
    @Body() dto: UpdateMarketDataSourceDto,
    @Request() req: AuthRequest,
  ) {
    return this.benchmarkingService.updateSource(req.user.tenantId, id, dto);
  }
}
