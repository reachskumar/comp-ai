import {
  Controller,
  Post,
  Get,
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
import { TenantGuard } from '../../../common';
import { WebhookService } from '../services/webhook.service';
import { CreateWebhookDto } from '../dto/create-webhook.dto';

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('integrations-webhooks')
@Controller('integrations')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  // ── Authenticated endpoints ──────────────────────────────────

  @Post('webhooks')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({ summary: 'Register a webhook endpoint' })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateWebhookDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.create(req.user.tenantId, dto);
  }

  @Get('connectors/:connectorId/webhooks')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({ summary: 'List webhooks for a connector' })
  async list(
    @Param('connectorId') connectorId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.findByConnector(req.user.tenantId, connectorId);
  }

  @Delete('webhooks/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.webhookService.delete(req.user.tenantId, id);
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

