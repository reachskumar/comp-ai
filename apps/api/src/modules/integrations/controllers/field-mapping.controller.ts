import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../../auth';
import { TenantGuard } from '../../../common';
import { FieldMappingService } from '../services/field-mapping.service';
import { CreateFieldMappingDto } from '../dto/create-field-mapping.dto';

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('integrations-field-mappings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('integrations/field-mappings')
export class FieldMappingController {
  constructor(private readonly fieldMappingService: FieldMappingService) {}

  @Post()
  @ApiOperation({ summary: 'Create a field mapping' })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateFieldMappingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.fieldMappingService.create(req.user.tenantId, dto);
  }

  @Get('connector/:connectorId')
  @ApiOperation({ summary: 'List field mappings for a connector' })
  async listByConnector(
    @Param('connectorId') connectorId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.fieldMappingService.findByConnector(req.user.tenantId, connectorId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a field mapping' })
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.fieldMappingService.delete(req.user.tenantId, id);
  }
}

