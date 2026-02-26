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
import { JobArchitectureService } from './job-architecture.service';
import {
  CreateJobFamilyDto,
  UpdateJobFamilyDto,
  JobFamilyQueryDto,
  CreateJobLevelDto,
  UpdateJobLevelDto,
  JobLevelQueryDto,
  AssignEmployeesDto,
  CreateCareerLadderDto,
  UpdateCareerLadderDto,
  CareerLadderQueryDto,
} from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('job-architecture')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('job-architecture')
export class JobArchitectureController {
  constructor(private readonly service: JobArchitectureService) {}

  // ─── Summary ────────────────────────────────────────────────

  @Get('summary')
  @ApiOperation({ summary: 'Get job architecture summary stats' })
  async getSummary(@Request() req: AuthRequest) {
    return this.service.getSummary(req.user.tenantId);
  }

  // ─── Auto-assign ────────────────────────────────────────────

  @Post('auto-assign')
  @ApiOperation({ summary: 'Auto-assign employees to levels by jobFamily + level matching' })
  @HttpCode(HttpStatus.OK)
  async autoAssign(@Request() req: AuthRequest) {
    return this.service.autoAssignEmployees(req.user.tenantId);
  }

  // ─── Job Families CRUD ──────────────────────────────────────

  @Get('families')
  @ApiOperation({ summary: 'List job families' })
  async listFamilies(@Query() query: JobFamilyQueryDto, @Request() req: AuthRequest) {
    return this.service.listFamilies(req.user.tenantId, query);
  }

  @Get('families/:id')
  @ApiOperation({ summary: 'Get job family with levels' })
  async getFamily(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.getFamily(req.user.tenantId, id);
  }

  @Post('families')
  @ApiOperation({ summary: 'Create a job family' })
  @HttpCode(HttpStatus.CREATED)
  async createFamily(@Body() dto: CreateJobFamilyDto, @Request() req: AuthRequest) {
    return this.service.createFamily(req.user.tenantId, dto);
  }

  @Put('families/:id')
  @ApiOperation({ summary: 'Update a job family' })
  async updateFamily(
    @Param('id') id: string,
    @Body() dto: UpdateJobFamilyDto,
    @Request() req: AuthRequest,
  ) {
    return this.service.updateFamily(req.user.tenantId, id, dto);
  }

  @Delete('families/:id')
  @ApiOperation({ summary: 'Delete a job family' })
  async deleteFamily(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.deleteFamily(req.user.tenantId, id);
  }

  // ─── Job Levels CRUD ───────────────────────────────────────

  @Get('levels')
  @ApiOperation({ summary: 'List all job levels with filters' })
  async listLevels(@Query() query: JobLevelQueryDto, @Request() req: AuthRequest) {
    return this.service.listLevels(req.user.tenantId, query);
  }

  @Get('levels/:id')
  @ApiOperation({ summary: 'Get job level details with employees' })
  async getLevel(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.getLevel(req.user.tenantId, id);
  }

  @Post('families/:familyId/levels')
  @ApiOperation({ summary: 'Create a job level under a family' })
  @HttpCode(HttpStatus.CREATED)
  async createLevel(
    @Param('familyId') familyId: string,
    @Body() dto: CreateJobLevelDto,
    @Request() req: AuthRequest,
  ) {
    return this.service.createLevel(req.user.tenantId, familyId, dto);
  }

  @Put('levels/:id')
  @ApiOperation({ summary: 'Update a job level' })
  async updateLevel(
    @Param('id') id: string,
    @Body() dto: UpdateJobLevelDto,
    @Request() req: AuthRequest,
  ) {
    return this.service.updateLevel(req.user.tenantId, id, dto);
  }

  @Delete('levels/:id')
  @ApiOperation({ summary: 'Delete a job level' })
  async deleteLevel(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.deleteLevel(req.user.tenantId, id);
  }

  @Post('levels/:id/assign-employees')
  @ApiOperation({ summary: 'Bulk assign employees to a level' })
  @HttpCode(HttpStatus.OK)
  async assignEmployees(
    @Param('id') id: string,
    @Body() dto: AssignEmployeesDto,
    @Request() req: AuthRequest,
  ) {
    return this.service.assignEmployees(req.user.tenantId, id, dto);
  }

  // ─── Career Ladders CRUD ───────────────────────────────────

  @Get('career-ladders')
  @ApiOperation({ summary: 'List career ladders' })
  async listLadders(@Query() query: CareerLadderQueryDto, @Request() req: AuthRequest) {
    return this.service.listLadders(req.user.tenantId, query);
  }

  @Get('career-ladders/:id')
  @ApiOperation({ summary: 'Get career ladder with progression paths' })
  async getLadder(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.getLadder(req.user.tenantId, id);
  }

  @Post('career-ladders')
  @ApiOperation({ summary: 'Create a career ladder' })
  @HttpCode(HttpStatus.CREATED)
  async createLadder(@Body() dto: CreateCareerLadderDto, @Request() req: AuthRequest) {
    return this.service.createLadder(req.user.tenantId, dto);
  }

  @Put('career-ladders/:id')
  @ApiOperation({ summary: 'Update a career ladder' })
  async updateLadder(
    @Param('id') id: string,
    @Body() dto: UpdateCareerLadderDto,
    @Request() req: AuthRequest,
  ) {
    return this.service.updateLadder(req.user.tenantId, id, dto);
  }

  @Delete('career-ladders/:id')
  @ApiOperation({ summary: 'Delete a career ladder' })
  async deleteLadder(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.deleteLadder(req.user.tenantId, id);
  }
}
