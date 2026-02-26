import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
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
import { EquityService } from './equity.service';
import {
  CreateEquityPlanDto,
  UpdateEquityPlanDto,
  EquityPlanQueryDto,
  CreateEquityGrantDto,
  UpdateEquityGrantDto,
  EquityGrantQueryDto,
} from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('equity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('equity')
export class EquityController {
  constructor(private readonly equityService: EquityService) {}

  // ─── Plans CRUD ───────────────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: 'List equity plans' })
  async listPlans(@Query() query: EquityPlanQueryDto, @Request() req: AuthRequest) {
    return this.equityService.listPlans(req.user.tenantId, query);
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get equity plan details with grants' })
  async getPlan(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.equityService.getPlan(req.user.tenantId, id);
  }

  @Post('plans')
  @ApiOperation({ summary: 'Create an equity plan' })
  @HttpCode(HttpStatus.CREATED)
  async createPlan(@Body() dto: CreateEquityPlanDto, @Request() req: AuthRequest) {
    return this.equityService.createPlan(req.user.tenantId, dto);
  }

  @Put('plans/:id')
  @ApiOperation({ summary: 'Update an equity plan' })
  async updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateEquityPlanDto,
    @Request() req: AuthRequest,
  ) {
    return this.equityService.updatePlan(req.user.tenantId, id, dto);
  }

  @Delete('plans/:id')
  @ApiOperation({ summary: 'Delete an equity plan' })
  async deletePlan(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.equityService.deletePlan(req.user.tenantId, id);
  }

  // ─── Grants CRUD ──────────────────────────────────────────────

  @Get('grants')
  @ApiOperation({ summary: 'List equity grants with filters' })
  async listGrants(@Query() query: EquityGrantQueryDto, @Request() req: AuthRequest) {
    return this.equityService.listGrants(req.user.tenantId, query);
  }

  @Get('grants/:id')
  @ApiOperation({ summary: 'Get grant details with vesting events' })
  async getGrant(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.equityService.getGrant(req.user.tenantId, id);
  }

  @Post('grants')
  @ApiOperation({ summary: 'Create an equity grant (auto-generates vesting events)' })
  @HttpCode(HttpStatus.CREATED)
  async createGrant(@Body() dto: CreateEquityGrantDto, @Request() req: AuthRequest) {
    return this.equityService.createGrant(req.user.tenantId, dto);
  }

  @Put('grants/:id')
  @ApiOperation({ summary: 'Update an equity grant' })
  async updateGrant(
    @Param('id') id: string,
    @Body() dto: UpdateEquityGrantDto,
    @Request() req: AuthRequest,
  ) {
    return this.equityService.updateGrant(req.user.tenantId, id, dto);
  }

  @Patch('grants/:id/cancel')
  @ApiOperation({ summary: 'Cancel an equity grant and its scheduled vesting events' })
  async cancelGrant(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.equityService.cancelGrant(req.user.tenantId, id);
  }

  // ─── Portfolio & Dashboard ────────────────────────────────────

  @Get('portfolio/:employeeId')
  @ApiOperation({ summary: 'Get employee equity portfolio (all grants + total value)' })
  async getPortfolio(@Param('employeeId') employeeId: string, @Request() req: AuthRequest) {
    return this.equityService.getEmployeePortfolio(req.user.tenantId, employeeId);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get equity dashboard stats (total issued, dilution, upcoming vests)' })
  async getDashboard(@Request() req: AuthRequest) {
    return this.equityService.getDashboard(req.user.tenantId);
  }
}
