import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
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
  suspendTenant(@Param('id') id: string) {
    return this.service.suspendTenant(id);
  }

  @Post('tenants/:id/activate')
  @ApiOperation({ summary: 'Re-activate a suspended tenant' })
  activateTenant(@Param('id') id: string) {
    return this.service.activateTenant(id);
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
    summary: 'Full sync: roles, pages, permissions, users, and employees from Compport Cloud SQL',
  })
  async syncTenantFull(@Param('id') id: string, @Res() reply: any) {
    // Use chunked transfer encoding to keep the HTTP connection alive.
    // Cloud Run kills background tasks when no active request is open.
    // Fastify: use reply.raw (Node http.ServerResponse) for streaming.
    const raw = reply.raw;
    raw.setHeader('Content-Type', 'application/x-ndjson');
    raw.setHeader('Transfer-Encoding', 'chunked');
    raw.flushHeaders();

    // Send a keep-alive ping every 30s so load balancers don't time out
    const keepAlive = setInterval(() => {
      try {
        raw.write(JSON.stringify({ type: 'ping', ts: new Date().toISOString() }) + '\n');
      } catch {
        /* connection closed */
      }
    }, 30_000);

    try {
      raw.write(JSON.stringify({ type: 'started', tenantId: id }) + '\n');
      const result = await this.service.syncTenantFull(id);
      raw.write(JSON.stringify({ type: 'complete', ...result }) + '\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`sync-full failed for tenant ${id}: ${message}`);
      raw.write(JSON.stringify({ type: 'error', message }) + '\n');
    } finally {
      clearInterval(keepAlive);
      raw.end();
    }
  }

  @Post('tenants/:id/test-connection')
  @ApiOperation({
    summary: "Test Cloud SQL connectivity for a tenant's Compport schema",
  })
  testTenantConnection(@Param('id') id: string) {
    return this.service.testTenantConnection(id);
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
