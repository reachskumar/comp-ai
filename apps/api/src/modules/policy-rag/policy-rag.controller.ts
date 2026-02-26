import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
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
import { PolicyRagService } from './policy-rag.service';
import { AskPolicyDto, PolicyQueryDto } from './dto';
import { formatSSE } from '@compensation/ai';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('policies')
export class PolicyRagController {
  private readonly logger = new Logger(PolicyRagController.name);

  constructor(private readonly policyRagService: PolicyRagService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a policy document (text content)' })
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Body() body: { title: string; fileName: string; content: string; mimeType?: string },
    @Request() req: AuthRequest,
  ) {
    const { tenantId, userId } = req.user;
    this.logger.log(`Policy upload: user=${userId} tenant=${tenantId} file=${body.fileName}`);

    return this.policyRagService.uploadDocument(
      tenantId,
      userId,
      body.title,
      body.fileName,
      body.content,
      body.mimeType ?? 'text/plain',
    );
  }

  @Get()
  @ApiOperation({ summary: 'List uploaded policy documents' })
  async list(@Query() query: PolicyQueryDto, @Request() req: AuthRequest) {
    return this.policyRagService.listDocuments(req.user.tenantId, query);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a policy document and its chunks' })
  async delete(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.policyRagService.deleteDocument(req.user.tenantId, id);
  }

  @Post('ask')
  @ApiOperation({ summary: 'Ask a question about company policies (SSE streaming response)' })
  @HttpCode(HttpStatus.OK)
  async ask(@Body() dto: AskPolicyDto, @Request() req: AuthRequest, @Res() reply: FastifyReply) {
    const { tenantId, userId } = req.user;

    this.logger.log(
      `Policy ask: user=${userId} tenant=${tenantId} conv=${dto.conversationId ?? 'new'}`,
    );

    // Set SSE headers
    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      const sseStream = this.policyRagService.streamAsk(
        tenantId,
        userId,
        dto.question,
        dto.conversationId,
      );

      for await (const event of sseStream) {
        reply.raw.write(formatSSE(event));
      }
    } catch (error) {
      this.logger.error('Policy ask error', error);
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
