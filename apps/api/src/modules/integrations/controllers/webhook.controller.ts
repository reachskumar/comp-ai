import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  Req,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../../auth';
import { TenantGuard, PermissionGuard, RequirePermission } from '../../../common';
import { WebhookService } from '../services/webhook.service';
import { WebhookDeliveryService } from '../services/webhook-delivery.service';
import { CreateWebhookDto } from '../dto/create-webhook.dto';
import { UpdateWebhookDto } from '../dto/update-webhook.dto';

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('integrations-webhooks')
@Controller('integrations')
export class WebhookController {
  constructor(
    private readonly webhookService: WebhookService,
    private readonly webhookDeliveryService: WebhookDeliveryService,
  ) {}

  // ── Authenticated endpoints ──────────────────────────────────

  @Post('webhooks')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
  @RequirePermission('Integrations', 'insert')
  @ApiOperation({ summary: 'Register a webhook endpoint' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateWebhookDto, @Req() req: AuthenticatedRequest) {
    return this.webhookService.create(req.user.tenantId, dto);
  }

  @Get('webhooks')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({ summary: 'List all webhook endpoints for tenant' })
  async listAll(@Req() req: AuthenticatedRequest) {
    return this.webhookService.findAll(req.user.tenantId);
  }

  @Get('connectors/:connectorId/webhooks')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
  @RequirePermission('Integrations', 'view')
  @ApiOperation({ summary: 'List webhooks for a connector' })
  async list(@Param('connectorId') connectorId: string, @Req() req: AuthenticatedRequest) {
    return this.webhookService.findByConnector(req.user.tenantId, connectorId);
  }

  @Put('webhooks/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({ summary: 'Update a webhook endpoint' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.update(req.user.tenantId, id, dto);
  }

  @Delete('webhooks/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
  @RequirePermission('Integrations', 'delete')
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.webhookService.delete(req.user.tenantId, id);
  }

  @Post('webhooks/:id/test')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({ summary: 'Send a test event to a webhook endpoint' })
  @HttpCode(HttpStatus.OK)
  async testWebhook(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookDeliveryService.sendTestEvent(req.user.tenantId, id);
  }

  // ── Inbound webhook endpoint (no JWT — uses HMAC verification) ──

  @Post('webhooks/inbound/:connectorId')
  @ApiOperation({ summary: 'Receive inbound webhook (HMAC-verified, no JWT)' })
  @HttpCode(HttpStatus.OK)
  async receiveInbound(
    @Param('connectorId') connectorId: string,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    return this.webhookService.processInbound(connectorId, signature, body);
  }
}
