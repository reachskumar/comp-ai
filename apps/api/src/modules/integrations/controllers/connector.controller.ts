import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Query,
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
import { ConnectorService } from '../services/connector.service';
import { SyncEngineService } from '../services/sync-engine.service';
import { CreateConnectorDto } from '../dto/create-connector.dto';
import { UpdateConnectorDto } from '../dto/update-connector.dto';
import { TriggerSyncDto } from '../dto/trigger-sync.dto';
import { ConnectorQueryDto, SyncLogQueryDto } from '../dto/connector-query.dto';

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('integrations/connectors')
export class ConnectorController {
  constructor(
    private readonly connectorService: ConnectorService,
    private readonly syncEngineService: SyncEngineService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Register a new integration connector' })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateConnectorDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.connectorService.create(req.user.tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List integration connectors' })
  async list(
    @Query() query: ConnectorQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.connectorService.findAll(req.user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get connector details' })
  async getById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.connectorService.findOne(req.user.tenantId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a connector' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateConnectorDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.connectorService.update(req.user.tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a connector' })
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.connectorService.delete(req.user.tenantId, id);
  }

  @Post(':id/health-check')
  @ApiOperation({ summary: 'Run health check on a connector' })
  @HttpCode(HttpStatus.OK)
  async healthCheck(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.connectorService.healthCheck(req.user.tenantId, id);
  }

  @Post(':id/sync')
  @ApiOperation({ summary: 'Trigger a sync job for a connector' })
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerSync(
    @Param('id') id: string,
    @Body() dto: TriggerSyncDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.syncEngineService.triggerSync(req.user.tenantId, id, dto);
  }

  @Get(':id/sync-jobs')
  @ApiOperation({ summary: 'List sync jobs for a connector' })
  async listSyncJobs(
    @Param('id') id: string,
    @Query() query: ConnectorQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.syncEngineService.listSyncJobs(req.user.tenantId, id, query);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Get sync logs for a connector' })
  async getSyncLogs(
    @Param('id') id: string,
    @Query() query: SyncLogQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.syncEngineService.getSyncLogs(req.user.tenantId, id, query);
  }
}

