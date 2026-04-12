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
  constructor(private readonly service: PlatformAdminService) {}

  // ─── Compport Tenant Discovery ───────────────────────────
  // NOTE: Must be above tenants/:id to avoid route parameter capture

  @Get('compport-tenants')
  @ApiOperation({ summary: 'List available Compport tenants from Cloud SQL' })
  listCompportTenants() {
    return this.service.listCompportTenants();
  }

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

  @Delete('tenants/:id')
  @ApiOperation({ summary: 'Permanently delete a tenant and all its data' })
  deleteTenant(@Param('id') id: string) {
    return this.service.deleteTenant(id);
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

  // ─── Tenant Overview & Roles ────────────────────────────

  @Get('tenants/:id/overview')
  @ApiOperation({ summary: 'Full tenant overview: counts, role distribution, sync status' })
  getTenantOverview(@Param('id') id: string) {
    return this.service.getTenantOverview(id);
  }

  @Get('tenants/:id/sync-status')
  @ApiOperation({ summary: 'Recent sync jobs for a tenant' })
  getTenantSyncStatus(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.service.getTenantSyncStatus(id, limit ? parseInt(limit, 10) : 10);
  }

  @Get('tenants/:id/roles')
  @ApiOperation({ summary: 'List synced Compport roles with user counts' })
  getTenantRoles(@Param('id') id: string) {
    return this.service.getTenantRoles(id);
  }

  @Get('tenants/:id/permissions')
  @ApiOperation({ summary: 'Full role→page permission matrix for a tenant' })
  getTenantPermissions(@Param('id') id: string) {
    return this.service.getTenantPermissions(id);
  }

  @Post('tenants/:id/sync-roles')
  @ApiOperation({
    summary: 'Re-sync roles, pages, and permissions from Compport Cloud SQL',
  })
  syncTenantRoles(@Param('id') id: string) {
    return this.service.syncTenantRoles(id);
  }

  @Post('tenants/:id/sync-full')
  @ApiOperation({
    summary:
      'Start a full sync (roles, permissions, users, employees). Returns immediately with a jobId — UI polls /sync-jobs/:jobId for progress.',
  })
  async syncTenantFull(@Param('id') id: string) {
    return this.service.startTenantFullSync(id);
  }

  @Get('tenants/:id/sync-jobs/:jobId')
  @ApiOperation({ summary: 'Poll a single sync job by id' })
  getSyncJob(@Param('id') id: string, @Param('jobId') jobId: string) {
    return this.service.getSyncJob(id, jobId);
  }

  @Post('tenants/:id/test-connection')
  @ApiOperation({
    summary: "Test Cloud SQL connectivity for a tenant's Compport schema",
  })
  testTenantConnection(@Param('id') id: string) {
    return this.service.testTenantConnection(id);
  }

  @Get('tenants/:id/data-audit')
  @ApiOperation({
    summary:
      "List every table in the tenant's Compport schema with row counts and sync coverage",
  })
  auditTenantData(@Param('id') id: string) {
    return this.service.auditTenantData(id);
  }

  @Post('tenants/:id/discover-comp-tables')
  @ApiOperation({
    summary:
      'Scan the tenant Compport schema for compensation/performance tables and persist the result in connector config (BLOCKER 6 prep).',
  })
  discoverCompTables(@Param('id') id: string) {
    return this.service.discoverCompensationTables(id);
  }

  @Post('tenants/:id/discover-schema')
  @ApiOperation({
    summary:
      'Universal discovery — catalog EVERY table in the tenant Compport schema. Required before mirror sync.',
  })
  discoverSchema(@Param('id') id: string) {
    return this.service.discoverTenantSchema(id);
  }

  @Post('tenants/:id/sync-mirror')
  @ApiOperation({
    summary:
      'Mirror sync — copy every mirrorable table from Compport MySQL to the tenant\'s Postgres mirror schema. Run discover-schema first.',
  })
  syncMirror(@Param('id') id: string) {
    return this.service.syncTenantMirror(id);
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

  // ─── Audit Logs ─────────────────────────────────────────

  @Get('audit-logs')
  @ApiOperation({ summary: 'List audit logs across all tenants (paginated, filterable)' })
  listAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('tenantId') tenantId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.listAuditLogs({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      tenantId,
      userId,
      action,
      entityType,
      dateFrom,
      dateTo,
    });
  }

  @Get('tenants/:id/audit-logs')
  @ApiOperation({ summary: 'List audit logs for a specific tenant' })
  getTenantAuditLogs(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getTenantAuditLogs(id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      userId,
      action,
      entityType,
      dateFrom,
      dateTo,
    });
  }
}
