import { Body, Controller, Get, Logger, Put, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard, PermissionGuard, RequirePermission } from '../../common';
import { SettingsService } from './settings.service';
import { AuditLogQueryDto, UpdateLetterApprovalChainDto, UpdateLetterSignatureDto } from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  @Get('tenant')
  @ApiOperation({ summary: 'Get current tenant info' })
  async getTenantInfo(@Request() req: AuthRequest) {
    return this.settingsService.getTenantInfo(req.user.tenantId);
  }

  @Put('letter-signature')
  @ApiOperation({ summary: 'Update the per-tenant letter signature (name + title)' })
  @RequirePermission('Settings', 'update')
  async updateLetterSignature(@Body() dto: UpdateLetterSignatureDto, @Request() req: AuthRequest) {
    this.logger.log(`Update letter signature: tenant=${req.user.tenantId} user=${req.user.userId}`);
    return this.settingsService.updateLetterSignature(req.user.tenantId, dto);
  }

  @Put('letter-approval-chain')
  @ApiOperation({
    summary: 'Replace the per-tenant letter approval chain (ordered list of role/label steps).',
  })
  @RequirePermission('Settings', 'update')
  async updateLetterApprovalChain(
    @Body() dto: UpdateLetterApprovalChainDto,
    @Request() req: AuthRequest,
  ) {
    this.logger.log(
      `Update letter approval chain: tenant=${req.user.tenantId} user=${req.user.userId} steps=${dto.chain.length}`,
    );
    return this.settingsService.updateLetterApprovalChain(req.user.tenantId, dto);
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users in the tenant' })
  async listUsers(@Request() req: AuthRequest) {
    return this.settingsService.listUsers(req.user.tenantId);
  }

  @Get('employees')
  @ApiOperation({ summary: 'Search employees by name, department, or code' })
  async searchEmployees(
    @Query('search') search: string,
    @Query('limit') limitStr: string,
    @Request() req: AuthRequest,
  ) {
    return this.settingsService.searchEmployees(
      req.user.tenantId,
      search,
      parseInt(limitStr || '10', 10),
    );
  }

  @Get('audit-logs/summary')
  @ApiOperation({ summary: 'Get audit log summary stats (action counts + top users)' })
  async getAuditLogSummary(
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Request() req: AuthRequest,
  ) {
    return this.settingsService.getAuditLogSummary(req.user.tenantId, { dateFrom, dateTo });
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'List audit log entries' })
  async listAuditLogs(@Query() query: AuditLogQueryDto, @Request() req: AuthRequest) {
    return this.settingsService.listAuditLogs(req.user.tenantId, query);
  }
}
