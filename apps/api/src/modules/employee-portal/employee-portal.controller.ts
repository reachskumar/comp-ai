import { Controller, Get, UseGuards, Request, Logger, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { EmployeePortalService } from './employee-portal.service';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('employee-portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('employee-portal')
export class EmployeePortalController {
  private readonly logger = new Logger(EmployeePortalController.name);

  constructor(private readonly portalService: EmployeePortalService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get authenticated employee profile with comp details' })
  async getMe(@Request() req: AuthRequest) {
    this.logger.log(`Employee portal /me: user=${req.user.userId}`);
    const result = await this.portalService.getMe(req.user.tenantId, req.user.userId);
    if (!result) throw new NotFoundException('No employee record linked to your account');
    return result;
  }

  @Get('me/comp-history')
  @ApiOperation({ summary: 'Get compensation change history for authenticated employee' })
  async getCompHistory(@Request() req: AuthRequest) {
    this.logger.log(`Employee portal /me/comp-history: user=${req.user.userId}`);
    return this.portalService.getCompHistory(req.user.tenantId, req.user.userId);
  }

  @Get('me/equity')
  @ApiOperation({ summary: 'Get equity grants and vesting for authenticated employee' })
  async getEquity(@Request() req: AuthRequest) {
    this.logger.log(`Employee portal /me/equity: user=${req.user.userId}`);
    return this.portalService.getEquity(req.user.tenantId, req.user.userId);
  }

  @Get('me/benefits')
  @ApiOperation({ summary: 'Get active benefit enrollments for authenticated employee' })
  async getBenefits(@Request() req: AuthRequest) {
    this.logger.log(`Employee portal /me/benefits: user=${req.user.userId}`);
    return this.portalService.getBenefits(req.user.tenantId, req.user.userId);
  }

  @Get('me/career-path')
  @ApiOperation({ summary: 'Get career path and progression for authenticated employee' })
  async getCareerPath(@Request() req: AuthRequest) {
    this.logger.log(`Employee portal /me/career-path: user=${req.user.userId}`);
    return this.portalService.getCareerPath(req.user.tenantId, req.user.userId);
  }

  @Get('me/documents')
  @ApiOperation({ summary: 'Get comp letters and reward statements for authenticated employee' })
  async getDocuments(@Request() req: AuthRequest) {
    this.logger.log(`Employee portal /me/documents: user=${req.user.userId}`);
    return this.portalService.getDocuments(req.user.tenantId, req.user.userId);
  }
}
