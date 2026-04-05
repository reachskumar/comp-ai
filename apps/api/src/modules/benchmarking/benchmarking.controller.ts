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
import { TenantGuard, PermissionGuard, RequirePermission } from '../../common';
import { BenchmarkingService } from './benchmarking.service';
import { MarketDataSyncService } from './market-data-sync.service';
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
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@RequirePermission('Benchmarking', 'view')
@Controller('benchmarking')
export class BenchmarkingController {
  constructor(
    private readonly benchmarkingService: BenchmarkingService,
    private readonly syncService: MarketDataSyncService,
  ) {}

  // ─── Salary Bands CRUD ────────────────────────────────────────

  @Get('bands')
  @ApiOperation({ summary: 'List salary bands with filters' })
  async listBands(@Query() query: SalaryBandQueryDto, @Request() req: AuthRequest) {
    return this.benchmarkingService.listBands(req.user.tenantId, query);
  }

  @Post('bands')
  @RequirePermission('Benchmarking', 'insert')
  @ApiOperation({ summary: 'Create a salary band' })
  @HttpCode(HttpStatus.CREATED)
  async createBand(@Body() dto: CreateSalaryBandDto, @Request() req: AuthRequest) {
    return this.benchmarkingService.createBand(req.user.tenantId, dto);
  }

  @Put('bands/:id')
  @RequirePermission('Benchmarking', 'update')
  @ApiOperation({ summary: 'Update a salary band' })
  async updateBand(
    @Param('id') id: string,
    @Body() dto: UpdateSalaryBandDto,
    @Request() req: AuthRequest,
  ) {
    return this.benchmarkingService.updateBand(req.user.tenantId, id, dto);
  }

  @Delete('bands/:id')
  @RequirePermission('Benchmarking', 'delete')
  @ApiOperation({ summary: 'Delete a salary band' })
  async deleteBand(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.benchmarkingService.deleteBand(req.user.tenantId, id);
  }

  @Post('bands/import')
  @RequirePermission('Benchmarking', 'insert')
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
  @RequirePermission('Benchmarking', 'insert')
  @ApiOperation({ summary: 'Add a market data source' })
  @HttpCode(HttpStatus.CREATED)
  async createSource(@Body() dto: CreateMarketDataSourceDto, @Request() req: AuthRequest) {
    return this.benchmarkingService.createSource(req.user.tenantId, dto);
  }

  @Put('sources/:id')
  @RequirePermission('Benchmarking', 'update')
  @ApiOperation({ summary: 'Update a market data source' })
  async updateSource(
    @Param('id') id: string,
    @Body() dto: UpdateMarketDataSourceDto,
    @Request() req: AuthRequest,
  ) {
    return this.benchmarkingService.updateSource(req.user.tenantId, id, dto);
  }

  // ─── Market Data Sync ────────────────────────────────────────

  @Get('providers')
  @ApiOperation({ summary: 'List available market data provider adapters' })
  async listProviders() {
    return this.syncService.getAvailableProviders();
  }

  @Post('sources/:id/sync')
  @ApiOperation({ summary: 'Sync salary bands from a market data source' })
  @HttpCode(HttpStatus.OK)
  async syncSource(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() body: { jobFamily?: string; location?: string },
  ) {
    return this.syncService.syncSource(req.user.tenantId, id, body);
  }

  @Get('sources/:id/health')
  @ApiOperation({ summary: 'Check if a market data source is reachable' })
  async checkSourceHealth(@Param('id') id: string, @Request() req: AuthRequest) {
    const healthy = await this.syncService.checkSourceHealth(req.user.tenantId, id);
    return { sourceId: id, healthy };
  }
}
