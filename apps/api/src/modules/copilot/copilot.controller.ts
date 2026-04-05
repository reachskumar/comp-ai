import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
  Logger,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard, PermissionGuard, RequirePermission } from '../../common';
import { AiCostGuard } from '../../common/guards/ai-cost.guard';
import { CopilotService } from './copilot.service';
import { ChatMessageDto, ConversationQueryDto } from './dto';
import { formatSSE } from '@compensation/ai';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string; name?: string };
}

@ApiTags('copilot')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard, AiCostGuard)
@RequirePermission('AI Copilot', 'view')
@Throttle({ default: { limit: 20, ttl: 60000 } })
@Controller('copilot')
export class CopilotController {
  private readonly logger = new Logger(CopilotController.name);

  constructor(private readonly copilotService: CopilotService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Send a message to the AI Copilot (SSE streaming response)' })
  @HttpCode(HttpStatus.OK)
  async chat(@Body() dto: ChatMessageDto, @Request() req: AuthRequest, @Res() reply: FastifyReply) {
    const { tenantId, userId, role, name } = req.user;

    this.logger.log(
      `Copilot chat: user=${userId} role=${role} tenant=${tenantId} conv=${dto.conversationId ?? 'new'}`,
    );

    // Set SSE headers (include CORS headers since reply.raw.writeHead bypasses Fastify CORS plugin)
    const origin = reply.request.headers.origin;
    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(origin
        ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Credentials': 'true',
          }
        : {}),
    });

    try {
      const sseStream = this.copilotService.streamChat(
        tenantId,
        userId,
        dto.message,
        dto.conversationId,
        {
          role,
          name: name ?? 'User',
        },
      );

      for await (const event of sseStream) {
        reply.raw.write(formatSSE(event));
      }
    } catch (error) {
      this.logger.error('Copilot chat error', error);
      reply.raw.write(
        formatSSE({
          event: 'error',
          data: {
            message: error instanceof Error ? error.message : 'Internal error',
            timestamp: Date.now(),
          },
        }),
      );
    } finally {
      reply.raw.end();
    }
  }

  // ─── Conversation History Endpoints (Task 5) ──────────────

  @Get('conversations')
  @ApiOperation({ summary: 'List user conversations (paginated)' })
  async listConversations(@Query() query: ConversationQueryDto, @Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    return this.copilotService.listConversations(tenantId, userId, query.page, query.limit);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get a conversation with all messages' })
  async getConversation(@Param('id') id: string, @Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    const conversation = await this.copilotService.getConversation(tenantId, userId, id);
    if (!conversation) throw new NotFoundException(`Conversation ${id} not found`);
    return conversation;
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Delete a conversation' })
  @HttpCode(HttpStatus.OK)
  async deleteConversation(@Param('id') id: string, @Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    const result = await this.copilotService.deleteConversation(tenantId, userId, id);
    if (!result.deleted) throw new NotFoundException(`Conversation ${id} not found`);
    return { message: 'Conversation deleted' };
  }

  @Get('conversations/:id/export')
  @ApiOperation({ summary: 'Export a conversation as JSON (messages with metadata)' })
  async exportConversation(@Param('id') id: string, @Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    const conversation = await this.copilotService.getConversation(tenantId, userId, id);
    if (!conversation) throw new NotFoundException(`Conversation ${id} not found`);

    return {
      exportedAt: new Date().toISOString(),
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages?.length ?? 0,
        messages: (conversation.messages ?? []).map(
          (m: {
            id: string;
            role: string;
            content: string;
            metadata: unknown;
            createdAt: Date;
          }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            metadata: m.metadata,
            timestamp: m.createdAt,
          }),
        ),
      },
    };
  }
}
