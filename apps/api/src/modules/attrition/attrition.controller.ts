import { Controller, Get, Post, Query, Param, UseGuards, Request, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { AttritionService } from './attrition.service';
import { AttritionScoresQueryDto } from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('attrition')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('attrition')
export class AttritionController {
  private readonly logger = new Logger(AttritionController.name);

  constructor(private readonly attritionService: AttritionService) {}

  @Post('analyze')
  @ApiOperation({ summary: 'Run attrition risk analysis for all active employees' })
  async analyzeAll(@Request() req: AuthRequest) {
    this.logger.log(`Attrition analysis: user=${req.user.userId}`);
    return this.attritionService.analyzeAll(req.user.tenantId, req.user.userId);
  }

  @Post('analyze/:employeeId')
  @ApiOperation({ summary: 'Run attrition risk analysis for a single employee' })
  async analyzeEmployee(@Param('employeeId') employeeId: string, @Request() req: AuthRequest) {
    this.logger.log(`Attrition analysis for employee=${employeeId}`);
    return this.attritionService.analyzeEmployee(req.user.tenantId, req.user.userId, employeeId);
  }

  @Get('scores')
  @ApiOperation({ summary: 'List attrition risk scores with optional filters' })
  async getScores(@Query() query: AttritionScoresQueryDto, @Request() req: AuthRequest) {
    return this.attritionService.getScores(req.user.tenantId, {
      riskLevel: query.riskLevel,
      department: query.department,
    });
  }

  @Get('scores/:employeeId')
  @ApiOperation({ summary: 'Get detailed risk score for a specific employee' })
  async getEmployeeScore(@Param('employeeId') employeeId: string, @Request() req: AuthRequest) {
    return this.attritionService.getEmployeeScore(req.user.tenantId, employeeId);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get attrition risk dashboard summary' })
  async getDashboard(@Request() req: AuthRequest) {
    return this.attritionService.getDashboard(req.user.tenantId);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Get analysis run history' })
  async getRuns(@Request() req: AuthRequest) {
    return this.attritionService.getRuns(req.user.tenantId);
  }
}
