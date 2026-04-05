import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import { CreateTenantDto, UpdateTenantDto, CreateTenantUserDto, OnboardTenantDto } from './dto';

@ApiTags('platform-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('platform-admin')
export class PlatformAdminController {
  private readonly logger = new Logger(PlatformAdminController.name);

  constructor(private readonly service: PlatformAdminService) {}

  // ─── Tenant CRUD ──────────────────────────────────────────

  @Get('tenants')
  @ApiOperation({ summary: 'List all tenants (paginated)' })
  listTenants(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listTenants(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
    );
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: 'Get tenant detail' })
  getTenant(@Param('id') id: string) {
    return this.service.getTenant(id);
  }

  @Post('tenants')
  @ApiOperation({ summary: 'Create a new tenant' })
  createTenant(@Body() dto: CreateTenantDto) {
    return this.service.createTenant(dto);
  }

  @Patch('tenants/:id')
  @ApiOperation({ summary: 'Update tenant' })
  updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.service.updateTenant(id, dto);
  }

  @Post('tenants/:id/suspend')
  @ApiOperation({ summary: 'Suspend a tenant' })
  suspendTenant(@Param('id') id: string, @Request() req: { user: { userId: string } }) {
    return this.service.suspendTenant(id, req.user.userId);
  }

  @Post('tenants/:id/activate')
  @ApiOperation({ summary: 'Re-activate a suspended tenant' })
  activateTenant(@Param('id') id: string, @Request() req: { user: { userId: string } }) {
    return this.service.activateTenant(id, req.user.userId);
  }

  // ─── User Management ─────────────────────────────────────

  @Get('tenants/:id/users')
  @ApiOperation({ summary: 'List users in a tenant' })
  listTenantUsers(@Param('id') id: string) {
    return this.service.listTenantUsers(id);
  }

  @Post('tenants/:id/users')
  @ApiOperation({ summary: 'Create a user in a tenant' })
  createTenantUser(@Param('id') id: string, @Body() dto: CreateTenantUserDto) {
    return this.service.createTenantUser(id, dto);
  }

  @Delete('tenants/:id/users/:userId')
  @ApiOperation({ summary: 'Remove a user from a tenant' })
  removeTenantUser(@Param('id') id: string, @Param('userId') userId: string) {
    return this.service.removeTenantUser(id, userId);
  }

  // ─── Onboarding ──────────────────────────────────────────

  @Post('onboard')
  @ApiOperation({ summary: 'Onboard a Compport tenant (create tenant + connector + sync)' })
  onboardFromCompport(@Body() dto: OnboardTenantDto) {
    return this.service.onboardFromCompport(dto);
  }

  // ─── Tenant Deletion ──────────────────────────────────────

  @Delete('tenants/:id')
  @ApiOperation({ summary: 'Permanently delete a tenant and all data (GDPR)' })
  deleteTenant(
    @Param('id') id: string,
    @Request() req: { user: { userId: string } },
  ) {
    return this.service.deleteTenant(id, req.user.userId);
  }

  // ─── Tenant Usage ────────────────────────────────────────

  @Get('tenants/:id/usage')
  @ApiOperation({ summary: 'Get tenant resource usage' })
  getTenantUsage(@Param('id') id: string) {
    return this.service.getTenantUsage(id);
  }

  // ─── Admin Impersonation ─────────────────────────────────

  @Post('tenants/:id/users/:userId/impersonate')
  @ApiOperation({ summary: 'Impersonate a tenant user (generates scoped token info)' })
  impersonate(
    @Param('id') tenantId: string,
    @Param('userId') userId: string,
    @Request() req: { user: { userId: string } },
  ) {
    return this.service.impersonate(tenantId, userId, req.user.userId);
  }

  // ─── Admin Audit Log ─────────────────────────────────────

  @Get('audit-log')
  @ApiOperation({ summary: 'View platform admin action audit log' })
  getAdminAuditLog(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getAdminAuditLog(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  // ─── Stats ───────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide statistics' })
  getStats() {
    return this.service.getStats();
  }
}
