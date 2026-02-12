import {
  Controller,
  Post,
  Get,
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
import { BenefitsService } from './benefits.service';
import {
  CreatePlanDto,
  UpdatePlanDto,
  PlanQueryDto,
  CreateEnrollmentDto,
  UpdateEnrollmentStatusDto,
  EnrollmentQueryDto,
  CreateDependentDto,
  UpdateDependentDto,
  CreateLifeEventDto,
  ReviewLifeEventDto,
  CreateEnrollmentWindowDto,
  UpdateEnrollmentWindowDto,
} from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('benefits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/v1/benefits')
export class BenefitsController {
  constructor(private readonly benefitsService: BenefitsService) {}

  // ─── Plans ──────────────────────────────────────────────────────────

  @Post('plans')
  @ApiOperation({ summary: 'Create a benefit plan' })
  @HttpCode(HttpStatus.CREATED)
  async createPlan(@Body() dto: CreatePlanDto, @Request() req: AuthRequest) {
    return this.benefitsService.createPlan(req.user.tenantId, dto);
  }

  @Get('plans')
  @ApiOperation({ summary: 'List benefit plans' })
  async listPlans(@Query() query: PlanQueryDto, @Request() req: AuthRequest) {
    return this.benefitsService.listPlans(req.user.tenantId, query);
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get plan details with premium breakdown' })
  async getPlan(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.benefitsService.getPlan(req.user.tenantId, id);
  }

  @Patch('plans/:id')
  @ApiOperation({ summary: 'Update a benefit plan' })
  async updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.updatePlan(req.user.tenantId, id, dto);
  }

  @Delete('plans/:id')
  @ApiOperation({ summary: 'Delete a benefit plan' })
  async deletePlan(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.benefitsService.deletePlan(req.user.tenantId, id);
  }

  // ─── Enrollments ────────────────────────────────────────────────────

  @Post('enrollments')
  @ApiOperation({ summary: 'Create a benefit enrollment' })
  @HttpCode(HttpStatus.CREATED)
  async createEnrollment(
    @Body() dto: CreateEnrollmentDto,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.createEnrollment(req.user.tenantId, dto);
  }

  @Get('enrollments')
  @ApiOperation({ summary: 'List enrollments (paginated)' })
  async listEnrollments(
    @Query() query: EnrollmentQueryDto,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.listEnrollments(req.user.tenantId, query);
  }

  @Get('enrollments/:id')
  @ApiOperation({ summary: 'Get enrollment details' })
  async getEnrollment(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.getEnrollment(req.user.tenantId, id);
  }

  @Patch('enrollments/:id/status')
  @ApiOperation({ summary: 'Update enrollment status' })
  async updateEnrollmentStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEnrollmentStatusDto,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.updateEnrollmentStatus(
      req.user.tenantId,
      id,
      dto.status,
    );
  }

  // ─── Premium Calculator ─────────────────────────────────────────────

  @Get('plans/:id/premiums/:tier')
  @ApiOperation({ summary: 'Calculate premium breakdown for plan + tier' })
  async calculatePremiums(
    @Param('id') planId: string,
    @Param('tier') tier: string,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.calculatePremiums(
      req.user.tenantId,
      planId,
      tier,
    );
  }

  // ─── Dependents ─────────────────────────────────────────────────────

  @Post('dependents')
  @ApiOperation({ summary: 'Add a dependent' })
  @HttpCode(HttpStatus.CREATED)
  async createDependent(
    @Body() dto: CreateDependentDto,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.createDependent(req.user.tenantId, dto);
  }

  @Get('employees/:employeeId/dependents')
  @ApiOperation({ summary: 'List dependents for an employee' })
  async listDependents(@Param('employeeId') employeeId: string) {
    return this.benefitsService.listDependents(employeeId);
  }

  @Patch('dependents/:id')
  @ApiOperation({ summary: 'Update a dependent' })
  async updateDependent(
    @Param('id') id: string,
    @Body() dto: UpdateDependentDto,
  ) {
    return this.benefitsService.updateDependent(id, dto);
  }

  @Delete('dependents/:id')
  @ApiOperation({ summary: 'Delete a dependent' })
  async deleteDependent(@Param('id') id: string) {
    return this.benefitsService.deleteDependent(id);
  }

  // ─── Life Events ────────────────────────────────────────────────────

  @Post('life-events')
  @ApiOperation({ summary: 'File a life event' })
  @HttpCode(HttpStatus.CREATED)
  async createLifeEvent(
    @Body() dto: CreateLifeEventDto,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.createLifeEvent(req.user.tenantId, dto);
  }

  @Get('life-events')
  @ApiOperation({ summary: 'List life events' })
  async listLifeEvents(
    @Query('employeeId') employeeId: string | undefined,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.listLifeEvents(req.user.tenantId, employeeId);
  }

  @Patch('life-events/:id/review')
  @ApiOperation({ summary: 'Review (approve/deny) a life event' })
  async reviewLifeEvent(
    @Param('id') id: string,
    @Body() dto: ReviewLifeEventDto,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.reviewLifeEvent(
      req.user.tenantId,
      id,
      dto.status,
      req.user.userId,
    );
  }

  // ─── Enrollment Windows ─────────────────────────────────────────────

  @Post('enrollment-windows')
  @ApiOperation({ summary: 'Create an enrollment window' })
  @HttpCode(HttpStatus.CREATED)
  async createEnrollmentWindow(
    @Body() dto: CreateEnrollmentWindowDto,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.createEnrollmentWindow(req.user.tenantId, dto);
  }

  @Get('enrollment-windows')
  @ApiOperation({ summary: 'List enrollment windows' })
  async listEnrollmentWindows(@Request() req: AuthRequest) {
    return this.benefitsService.listEnrollmentWindows(req.user.tenantId);
  }

  @Patch('enrollment-windows/:id')
  @ApiOperation({ summary: 'Update an enrollment window' })
  async updateEnrollmentWindow(
    @Param('id') id: string,
    @Body() dto: UpdateEnrollmentWindowDto,
    @Request() req: AuthRequest,
  ) {
    return this.benefitsService.updateEnrollmentWindow(
      req.user.tenantId,
      id,
      dto,
    );
  }
}

