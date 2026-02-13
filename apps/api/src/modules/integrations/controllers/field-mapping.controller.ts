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
import { SuggestFieldMappingDto } from '../dto/suggest-field-mapping.dto';
import {
  listConnectorTemplates,
  getConnectorTemplate,
} from '../connectors/connector-templates';

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('integrations-field-mappings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('integrations/field-mappings')
export class FieldMappingController {
  constructor(private readonly fieldMappingService: FieldMappingService) {}

  @Post('suggest')
  @ApiOperation({ summary: 'Get AI-powered field mapping suggestions' })
  @HttpCode(HttpStatus.OK)
  async suggest(
    @Body() dto: SuggestFieldMappingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.fieldMappingService.suggestMappings(
      req.user.tenantId,
      req.user.userId,
      dto,
    );
  }

  @Get('templates')
  @ApiOperation({ summary: 'List available connector templates' })
  async listTemplates() {
    return listConnectorTemplates();
  }

  @Get('templates/:templateId')
  @ApiOperation({ summary: 'Get a connector template by ID' })
  async getTemplate(@Param('templateId') templateId: string) {
    const template = getConnectorTemplate(templateId);
    if (!template) {
      return { error: 'Template not found', statusCode: 404 };
    }
    return template;
  }

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

