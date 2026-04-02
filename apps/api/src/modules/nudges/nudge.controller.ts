import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard, PermissionGuard, RequirePermission } from '../../common';
import { NudgeService } from './nudge.service';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('nudges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@RequirePermission('Nudges', 'view')
@Controller('nudges')
export class NudgeController {
  constructor(private readonly nudgeService: NudgeService) {}

  @Get()
  @ApiOperation({ summary: 'Get proactive AI nudges based on employee data analysis' })
  async getNudges(@Request() req: AuthRequest) {
    return this.nudgeService.generateNudges(req.user.tenantId);
  }
}
