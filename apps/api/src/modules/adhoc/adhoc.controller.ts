import {
  Controller,
  Post,
  Get,
  Put,
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
import { AdHocService } from './adhoc.service';
import { CreateAdHocDto, UpdateAdHocDto, AdHocQueryDto, RejectAdHocDto } from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('adhoc')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('adhoc')
export class AdHocController {
  constructor(private readonly adhocService: AdHocService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new ad hoc increase request' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateAdHocDto, @Request() req: AuthRequest) {
    return this.adhocService.create(req.user.tenantId, req.user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List ad hoc requests with filters' })
  async list(@Query() query: AdHocQueryDto, @Request() req: AuthRequest) {
    return this.adhocService.list(req.user.tenantId, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get ad hoc request summary stats' })
  async getStats(@Request() req: AuthRequest) {
    return this.adhocService.getStats(req.user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ad hoc request details' })
  async getById(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.adhocService.getById(req.user.tenantId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a draft ad hoc request' })
  async update(@Param('id') id: string, @Body() dto: UpdateAdHocDto, @Request() req: AuthRequest) {
    return this.adhocService.update(req.user.tenantId, id, dto);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit ad hoc request for approval' })
  @HttpCode(HttpStatus.OK)
  async submit(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.adhocService.submit(req.user.tenantId, id);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve an ad hoc request' })
  @HttpCode(HttpStatus.OK)
  async approve(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.adhocService.approve(req.user.tenantId, id, req.user.userId);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject an ad hoc request' })
  @HttpCode(HttpStatus.OK)
  async reject(@Param('id') id: string, @Body() dto: RejectAdHocDto, @Request() req: AuthRequest) {
    return this.adhocService.reject(req.user.tenantId, id, req.user.userId, dto.reason);
  }

  @Post(':id/apply')
  @ApiOperation({ summary: 'Apply approved change to employee record' })
  @HttpCode(HttpStatus.OK)
  async apply(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.adhocService.apply(req.user.tenantId, id);
  }
}
