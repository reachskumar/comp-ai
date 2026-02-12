import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Res,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { CopilotService } from './copilot.service';
import { ChatMessageDto } from './dto';
import { formatSSE } from '@compensation/ai';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('copilot')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/v1/copilot')
export class CopilotController {
  private readonly logger = new Logger(CopilotController.name);

  constructor(private readonly copilotService: CopilotService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Send a message to the AI Copilot (SSE streaming response)' })
  @HttpCode(HttpStatus.OK)
  async chat(
    @Body() dto: ChatMessageDto,
    @Request() req: AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    const { tenantId, userId } = req.user;

    this.logger.log(
      `Copilot chat: user=${userId} tenant=${tenantId} conv=${dto.conversationId ?? 'new'}`,
    );

    // Set SSE headers
    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      const sseStream = this.copilotService.streamChat(
        tenantId,
        userId,
        dto.message,
        dto.conversationId,
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
}

