import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth';
import { TenantGuard } from '../../../common';
import { CompportDataService } from '../services/compport-data.service';
import { SchemaCatalogService } from '../services/schema-catalog.service';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

/**
 * Compport Data Controller — tenant-scoped direct reads from Compport MySQL.
 *
 * These endpoints power the UI pages with live Compport data.
 * No special permissions required — any authenticated tenant user can read.
 * Data is served via Redis cache (5 min TTL) in the service layer.
 */
@ApiTags('compport-data')
@Controller('compport-data')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
export class CompportDataController {
  private readonly logger = new Logger(CompportDataController.name);

  constructor(
    private readonly dataService: CompportDataService,
    private readonly catalogService: SchemaCatalogService,
  ) {}

  // ─── Compensation Cycles ──────────────────────────────────

  @Get('cycles')
  @ApiOperation({ summary: 'Get compensation cycles from Compport' })
  async getCycles(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 50);
    const rows = await this.dataService.getCompCycles(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  // ─── Salary Rules ─────────────────────────────────────────

  @Get('salary-rules')
  @ApiOperation({ summary: 'Get salary rules (hr_parameter) from Compport' })
  async getSalaryRules(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 100);
    const rows = await this.dataService.getSalaryRules(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  @Get('bonus-rules')
  @ApiOperation({ summary: 'Get bonus rules from Compport' })
  async getBonusRules(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 100);
    const rows = await this.dataService.getBonusRules(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  @Get('lti-rules')
  @ApiOperation({ summary: 'Get LTI/equity rules from Compport' })
  async getLtiRules(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 100);
    const rows = await this.dataService.getLtiRules(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  // ─── Employee Compensation ────────────────────────────────

  @Get('salary-details')
  @ApiOperation({ summary: 'Get employee salary details from Compport' })
  async getSalaryDetails(
    @Request() req: AuthRequest,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = this.parseLimit(limitStr, 50);
    const rows = await this.dataService.getEmployeeSalaryDetails(
      req.user.tenantId,
      undefined,
      limit,
    );
    return { data: rows, total: rows.length };
  }

  @Get('bonus-details')
  @ApiOperation({ summary: 'Get employee bonus details from Compport' })
  async getBonusDetails(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 50);
    const rows = await this.dataService.getEmployeeBonusDetails(
      req.user.tenantId,
      undefined,
      limit,
    );
    return { data: rows, total: rows.length };
  }

  @Get('lti-details')
  @ApiOperation({ summary: 'Get employee LTI/equity details from Compport' })
  async getLtiDetails(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 50);
    const rows = await this.dataService.getEmployeeLtiDetails(req.user.tenantId, undefined, limit);
    return { data: rows, total: rows.length };
  }

  // ─── Letters ──────────────────────────────────────────────

  @Get('letters')
  @ApiOperation({ summary: 'Get compensation letters from Compport' })
  async getLetters(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 50);
    const rows = await this.dataService.getLetters(req.user.tenantId, undefined, limit);
    return { data: rows, total: rows.length };
  }

  // ─── Market Data ──────────────────────────────────────────

  @Get('market-data')
  @ApiOperation({ summary: 'Get market data from Compport' })
  async getMarketData(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getMarketData(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  @Get('pay-ranges')
  @ApiOperation({ summary: 'Get pay range / market data from Compport' })
  async getPayRanges(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getPayRanges(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  // ─── Grade / Band / Level Structure ────────────────────────

  @Get('grade-bands')
  @ApiOperation({ summary: 'Get grade bands from Compport' })
  async getGradeBands(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getGradeBands(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  @Get('pay-grades')
  @ApiOperation({ summary: 'Get pay grades from Compport' })
  async getPayGrades(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getPayGrades(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  @Get('salary-bands')
  @ApiOperation({ summary: 'Get salary bands from Compport' })
  async getSalaryBands(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getSalaryBands(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  @Get('manage-bands')
  @ApiOperation({ summary: 'Get band hierarchy from Compport' })
  async getManageBands(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getManageBands(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  @Get('manage-grades')
  @ApiOperation({ summary: 'Get grade definitions from Compport' })
  async getManageGrades(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getManageGrades(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  @Get('manage-levels')
  @ApiOperation({ summary: 'Get level definitions from Compport' })
  async getManageLevels(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getManageLevels(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  @Get('manage-designations')
  @ApiOperation({ summary: 'Get designation definitions from Compport' })
  async getManageDesignations(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getManageDesignations(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  @Get('manage-functions')
  @ApiOperation({ summary: 'Get function/job family definitions from Compport' })
  async getManageFunctions(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getManageFunctions(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  // ─── Proration ────────────────────────────────────────────

  @Get('proration-rules')
  @ApiOperation({ summary: 'Get proration rules from Compport' })
  async getProrationRules(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 100);
    const rows = await this.dataService.getProrationRules(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  // ─── History ──────────────────────────────────────────────

  @Get('employee-history')
  @ApiOperation({ summary: 'Get employee history from Compport' })
  async getEmployeeHistory(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 50);
    const rows = await this.dataService.getEmployeeHistory(req.user.tenantId, undefined, limit);
    return { data: rows, total: rows.length };
  }

  // ─── Minimum Wage ─────────────────────────────────────────

  @Get('minimum-wage')
  @ApiOperation({ summary: 'Get minimum wage data from Compport' })
  async getMinimumWage(@Request() req: AuthRequest, @Query('limit') limitStr?: string) {
    const limit = this.parseLimit(limitStr, 200);
    const rows = await this.dataService.getMinimumWage(req.user.tenantId, limit);
    return { data: rows, total: rows.length };
  }

  // ─── Generic Table Query ──────────────────────────────────

  @Get('table/:tableName')
  @ApiOperation({ summary: 'Query any Compport table by name' })
  async queryTable(
    @Request() req: AuthRequest,
    @Param('tableName') tableName: string,
    @Query('limit') limitStr?: string,
    @Query('orderBy') orderBy?: string,
    @Query('orderDir') orderDir?: string,
  ) {
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new BadRequestException('Invalid table name');
    }
    const limit = this.parseLimit(limitStr, 50);
    const dir = orderDir?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const rows = await this.dataService.queryTable(
      req.user.tenantId,
      tableName,
      undefined,
      limit,
      orderBy,
      dir as 'ASC' | 'DESC',
    );
    return { data: rows, total: rows.length };
  }

  @Get('table/:tableName/count')
  @ApiOperation({ summary: 'Get row count for any Compport table' })
  async getTableCount(@Request() req: AuthRequest, @Param('tableName') tableName: string) {
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new BadRequestException('Invalid table name');
    }
    const count = await this.dataService.getTableCount(req.user.tenantId, tableName);
    return { tableName, count };
  }

  // ─── Audit ─────────────────────────────────────────────────

  @Get('audit')
  @ApiOperation({ summary: 'Audit all Compport data availability for this tenant' })
  async audit(@Request() req: AuthRequest) {
    const tenantId = req.user.tenantId;

    // Get catalog — all tables known for this tenant
    const catalog = await this.catalogService.getCatalog(tenantId);
    const catalogSummary = catalog.map((e) => ({
      table: e.tableName,
      rows: e.rowCount,
      columns: e.columns.map((c) => c.name),
      pk: e.primaryKeyColumns,
    }));

    // Try reading each key table and report result
    const tables = [
      'performance_cycle',
      'hr_parameter',
      'hr_parameter_bonus',
      'lti_rules',
      'employee_salary_details',
      'employee_bonus_details',
      'employee_lti_details',
      'letter_repository',
      'tbl_market_data',
      'payrange_market_data',
      'grade_band',
      'pay_grade',
      'salary_bands',
      'manage_band',
      'manage_grade',
      'manage_level',
      'manage_designation',
      'manage_function',
      'minimum_wage',
      'proration_based_assignment',
      'login_user_history',
      'login_user',
    ];

    const results: Record<
      string,
      {
        inCatalog: boolean;
        catalogRows: number;
        queriedRows: number;
        sample: unknown;
        error?: string;
      }
    > = {};

    for (const table of tables) {
      const catalogEntry = catalog.find((e) => e.tableName === table);
      try {
        const rows = await this.dataService.queryTable(tenantId, table, undefined, 2);
        results[table] = {
          inCatalog: !!catalogEntry,
          catalogRows: catalogEntry?.rowCount ?? 0,
          queriedRows: rows.length,
          sample: rows[0] ?? null,
        };
      } catch (err) {
        results[table] = {
          inCatalog: !!catalogEntry,
          catalogRows: catalogEntry?.rowCount ?? 0,
          queriedRows: 0,
          sample: null,
          error: (err as Error).message?.substring(0, 200),
        };
      }
    }

    return {
      tenantId,
      totalCatalogTables: catalog.length,
      auditedTables: Object.keys(results).length,
      results,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────

  private parseLimit(str: string | undefined, defaultVal: number): number {
    if (!str) return defaultVal;
    const n = parseInt(str, 10);
    return Math.min(1000, Math.max(1, isNaN(n) ? defaultVal : n));
  }
}
