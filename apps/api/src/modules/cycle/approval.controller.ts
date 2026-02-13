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
import { ApprovalService } from './services/approval.service';
import { CalibrationService } from './services/calibration.service';
import {
  BulkApprovalDto,
  NudgeDto,
  PendingApprovalQueryDto,
} from './dto';
import {
  CreateCalibrationSessionDto,
  UpdateCalibrationSessionDto,
  CalibrationQueryDto,
} from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('cycle-approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('cycles')
export class ApprovalController {
  constructor(
    private readonly approvalService: ApprovalService,
    private readonly calibrationService: CalibrationService,
  ) {}

  // ─── Approval Endpoints ────────────────────────────────────────────────

  @Get(':id/approvals/pending')
  @ApiOperation({ summary: 'Get pending approvals for current user' })
  async getPendingApprovals(
    @Param('id') cycleId: string,
    @Query() query: PendingApprovalQueryDto,
    @Request() req: AuthRequest,
  ) {
    return this.approvalService.getPendingApprovals(
      req.user.tenantId,
      cycleId,
      req.user.userId,
      query,
    );
  }

  @Post(':id/approvals/bulk')
  @ApiOperation({ summary: 'Bulk approve or reject recommendations' })
  @HttpCode(HttpStatus.OK)
  async bulkApproveReject(
    @Param('id') cycleId: string,
    @Body() dto: BulkApprovalDto,
    @Request() req: AuthRequest,
  ) {
    return this.approvalService.bulkApproveReject(
      req.user.tenantId,
      cycleId,
      req.user.userId,
      dto,
    );
  }

  @Post(':id/approvals/escalate')
  @ApiOperation({ summary: 'Schedule escalation for pending approvals' })
  @HttpCode(HttpStatus.OK)
  async scheduleEscalation(
    @Param('id') cycleId: string,
    @Request() req: AuthRequest,
  ) {
    return this.approvalService.scheduleEscalation(
      req.user.tenantId,
      cycleId,
      req.user.userId,
    );
  }

  @Post(':id/nudge')
  @ApiOperation({ summary: 'Send reminders to pending approvers' })
  @HttpCode(HttpStatus.OK)
  async sendNudge(
    @Param('id') cycleId: string,
    @Body() dto: NudgeDto,
    @Request() req: AuthRequest,
  ) {
    return this.approvalService.sendNudge(
      req.user.tenantId,
      cycleId,
      req.user.userId,
      dto,
    );
  }

  @Get(':id/approvals/chain')
  @ApiOperation({ summary: 'Get the approval chain configuration for a cycle' })
  async getApprovalChain(@Param('id') cycleId: string) {
    const chain = await this.approvalService.getApprovalChain(cycleId);
    return { cycleId, approvalChain: chain };
  }

  // ─── Calibration Endpoints ─────────────────────────────────────────────

  @Post(':id/calibration')
  @ApiOperation({ summary: 'Create a calibration session' })
  @HttpCode(HttpStatus.CREATED)
  async createCalibrationSession(
    @Param('id') cycleId: string,
    @Body() dto: CreateCalibrationSessionDto,
    @Request() req: AuthRequest,
  ) {
    return this.calibrationService.createSession(
      req.user.tenantId,
      cycleId,
      req.user.userId,
      dto,
    );
  }

  @Get(':id/calibration')
  @ApiOperation({ summary: 'List calibration sessions for a cycle' })
  async listCalibrationSessions(
    @Param('id') cycleId: string,
    @Query() query: CalibrationQueryDto,
    @Request() req: AuthRequest,
  ) {
    return this.calibrationService.listSessions(
      req.user.tenantId,
      cycleId,
      query,
    );
  }


  @Get(':id/calibration/:sessionId')
  @ApiOperation({ summary: 'Get calibration session details' })
  async getCalibrationSession(
    @Param('id') cycleId: string,
    @Param('sessionId') sessionId: string,
    @Request() req: AuthRequest,
  ) {
    return this.calibrationService.getSession(
      req.user.tenantId,
      cycleId,
      sessionId,
    );
  }

  @Patch(':id/calibration/:sessionId')
  @ApiOperation({ summary: 'Update calibration session outcomes and status' })
  async updateCalibrationSession(
    @Param('id') cycleId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateCalibrationSessionDto,
    @Request() req: AuthRequest,
  ) {
    return this.calibrationService.updateSession(
      req.user.tenantId,
      cycleId,
      sessionId,
      req.user.userId,
      dto,
    );
  }

  @Post(':id/calibration/:sessionId/lock')
  @ApiOperation({ summary: 'Lock recommendations during calibration' })
  @HttpCode(HttpStatus.OK)
  async lockRecommendations(
    @Param('id') cycleId: string,
    @Param('sessionId') sessionId: string,
    @Request() req: AuthRequest,
  ) {
    return this.calibrationService.lockRecommendations(
      req.user.tenantId,
      cycleId,
      sessionId,
      req.user.userId,
    );
  }

  @Post(':id/calibration/:sessionId/unlock')
  @ApiOperation({ summary: 'Unlock recommendations after calibration' })
  @HttpCode(HttpStatus.OK)
  async unlockRecommendations(
    @Param('id') cycleId: string,
    @Param('sessionId') sessionId: string,
    @Request() req: AuthRequest,
  ) {
    return this.calibrationService.unlockRecommendations(
      req.user.tenantId,
      cycleId,
      sessionId,
      req.user.userId,
    );
  }
}