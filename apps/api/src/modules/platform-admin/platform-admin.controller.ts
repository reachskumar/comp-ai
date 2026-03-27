import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
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
  suspendTenant(@Param('id') id: string) {
    return this.service.suspendTenant(id);
  }

  @Post('tenants/:id/activate')
  @ApiOperation({ summary: 'Re-activate a suspended tenant' })
  activateTenant(@Param('id') id: string) {
    return this.service.activateTenant(id);
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

  // ─── Compport Tenant Discovery ───────────────────────────

  @Get('compport-tenants')
  @ApiOperation({ summary: 'List available Compport tenants from Cloud SQL' })
  listCompportTenants() {
    return this.service.listCompportTenants();
  }

  // ─── Onboarding ──────────────────────────────────────────

  @Post('onboard')
  @ApiOperation({ summary: 'Onboard a Compport tenant (create tenant + connector + sync)' })
  onboardFromCompport(@Body() dto: OnboardTenantDto) {
    return this.service.onboardFromCompport(dto);
  }

  // ─── Stats ───────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide statistics' })
  getStats() {
    return this.service.getStats();
  }
}
