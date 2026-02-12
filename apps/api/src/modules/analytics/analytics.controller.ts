import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { TotalRewardsService } from './total-rewards.service';
import { TotalRewardsQueryDto, TotalRewardsView } from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/v1/analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly totalRewardsService: TotalRewardsService) {}

  @Get('total-rewards')
  @ApiOperation({ summary: 'Get total rewards statement for the authenticated user' })
  async getTotalRewards(
    @Query() query: TotalRewardsQueryDto,
    @Request() req: AuthRequest,
  ) {
    this.logger.log(
      `Total rewards request: user=${req.user.userId} view=${query.view || 'personal'}`,
    );

    if (query.view === TotalRewardsView.TEAM) {
      return this.totalRewardsService.getTeamOverview(
        req.user.tenantId,
        req.user.userId,
        req.user.role,
      );
    }

    return this.totalRewardsService.getPersonalRewards(
      req.user.tenantId,
      req.user.userId,
      query.year,
    );
  }
}

