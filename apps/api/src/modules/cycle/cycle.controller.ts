import {
  Controller,
  Post,
  Get,
  Patch,
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
import { CycleService } from './cycle.service';
import {
  CreateCycleDto,
  UpdateCycleDto,
  TransitionCycleDto,
  BulkSetBudgetDto,
  SetBudgetDto,
  BulkCreateRecommendationDto,
  UpdateRecommendationStatusDto,
  CycleQueryDto,
  RecommendationQueryDto,
} from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('cycles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('cycles')
export class CycleController {
  constructor(private readonly cycleService: CycleService) {}

  // ─── Cycle CRUD ─────────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new compensation cycle' })
  @HttpCode(HttpStatus.CREATED)
  async createCycle(@Body() dto: CreateCycleDto, @Request() req: AuthRequest) {
    return this.cycleService.createCycle(req.user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List compensation cycles (paginated)' })
  async listCycles(@Query() query: CycleQueryDto, @Request() req: AuthRequest) {
    return this.cycleService.listCycles(req.user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get cycle details with budget summary' })
  async getCycle(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.cycleService.getCycle(req.user.tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update cycle details' })
  async updateCycle(
    @Param('id') id: string,
    @Body() dto: UpdateCycleDto,
    @Request() req: AuthRequest,
  ) {
    return this.cycleService.updateCycle(req.user.tenantId, id, dto);
  }

  // ─── State Machine ──────────────────────────────────────────────────

  @Patch(':id/transition')
  @ApiOperation({ summary: 'Advance cycle state (state machine transition)' })
  async transitionCycle(
    @Param('id') id: string,
    @Body() dto: TransitionCycleDto,
    @Request() req: AuthRequest,
  ) {
    return this.cycleService.transitionCycle(
      req.user.tenantId,
      id,
      dto.targetStatus,
      req.user.role,
      dto.reason,
    );
  }

  // ─── Budget Allocation ──────────────────────────────────────────────

  @Post(':id/budgets')
  @ApiOperation({ summary: 'Set department budgets (top-down allocation)' })
  @HttpCode(HttpStatus.OK)
  async setBudgets(
    @Param('id') id: string,
    @Body() dto: BulkSetBudgetDto,
    @Request() req: AuthRequest,
  ) {
    return this.cycleService.setBudgets(req.user.tenantId, id, dto);
  }

  @Post(':id/budgets/request')
  @ApiOperation({ summary: 'Request budget (bottom-up allocation)' })
  @HttpCode(HttpStatus.OK)
  async requestBudget(
    @Param('id') id: string,
    @Body() dto: SetBudgetDto,
    @Request() req: AuthRequest,
  ) {
    return this.cycleService.requestBudget(req.user.tenantId, id, dto);
  }

  // ─── Recommendations ────────────────────────────────────────────────

  @Post(':id/recommendations')
  @ApiOperation({ summary: 'Bulk create/update recommendations' })
  @HttpCode(HttpStatus.OK)
  async bulkCreateRecommendations(
    @Param('id') id: string,
    @Body() dto: BulkCreateRecommendationDto,
    @Request() req: AuthRequest,
  ) {
    return this.cycleService.bulkCreateRecommendations(
      req.user.tenantId,
      id,
      dto,
    );
  }

  @Get(':id/recommendations')
  @ApiOperation({ summary: 'List recommendations with filters' })
  async listRecommendations(
    @Param('id') id: string,
    @Query() query: RecommendationQueryDto,
    @Request() req: AuthRequest,
  ) {
    return this.cycleService.listRecommendations(req.user.tenantId, id, query);
  }

  @Patch(':id/recommendations/:recId/status')
  @ApiOperation({ summary: 'Update recommendation status' })
  async updateRecommendationStatus(
    @Param('id') id: string,
    @Param('recId') recId: string,
    @Body() dto: UpdateRecommendationStatusDto,
    @Request() req: AuthRequest,
  ) {
    return this.cycleService.updateRecommendationStatus(
      req.user.tenantId,
      id,
      recId,
      dto.status,
      req.user.userId,
    );
  }

  // ─── Summary ────────────────────────────────────────────────────────

  @Get(':id/summary')
  @ApiOperation({ summary: 'Get cycle summary with real-time budget and progress stats' })
  async getCycleSummary(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    return this.cycleService.getCycleSummary(req.user.tenantId, id);
  }
}

