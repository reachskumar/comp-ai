import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { MeritMatrixService } from './merit-matrix.service';
import { CreateMeritMatrixDto, UpdateMeritMatrixDto } from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('merit-matrix')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('merit-matrix')
export class MeritMatrixController {
  constructor(private readonly meritMatrixService: MeritMatrixService) {}

  @Get()
  @ApiOperation({ summary: 'List merit matrices for tenant' })
  async list(@Request() req: AuthRequest) {
    return this.meritMatrixService.list(req.user.tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get merit matrix by ID' })
  async getById(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.meritMatrixService.getById(req.user.tenantId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new merit matrix' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateMeritMatrixDto, @Request() req: AuthRequest) {
    return this.meritMatrixService.create(req.user.tenantId, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update merit matrix cells' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMeritMatrixDto,
    @Request() req: AuthRequest,
  ) {
    return this.meritMatrixService.update(req.user.tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a merit matrix' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @Request() req: AuthRequest) {
    await this.meritMatrixService.delete(req.user.tenantId, id);
  }

  @Post(':id/simulate')
  @ApiOperation({ summary: 'Simulate matrix against employee population' })
  @HttpCode(HttpStatus.OK)
  async simulate(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.meritMatrixService.simulate(req.user.tenantId, id);
  }

  @Post(':id/apply-to-cycle/:cycleId')
  @ApiOperation({ summary: 'Link matrix to a comp cycle and generate recommendations' })
  @HttpCode(HttpStatus.OK)
  async applyToCycle(
    @Param('id') id: string,
    @Param('cycleId') cycleId: string,
    @Request() req: AuthRequest,
  ) {
    return this.meritMatrixService.applyToCycle(req.user.tenantId, id, cycleId);
  }
}
