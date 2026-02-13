import {
  Controller,
  Post,
  Get,
  Body,
  Param,
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
import { ReportsService } from './reports.service';
import { GenerateReportDto, ExportReportDto } from './dto';
import { formatSSE } from '@compensation/ai';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/v1/reports')
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(private readonly reportsService: ReportsService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate a report from natural language (SSE streaming)' })
  @HttpCode(HttpStatus.OK)
  async generate(
    @Body() dto: GenerateReportDto,
    @Request() req: AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    const { tenantId, userId } = req.user;

    this.logger.log(
      `Report generate: user=${userId} tenant=${tenantId}`,
    );

    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      const sseStream = this.reportsService.streamGenerate(
        tenantId,
        userId,
        dto.prompt,
        dto.conversationId,
      );

      for await (const event of sseStream) {
        reply.raw.write(formatSSE(event));
      }
    } catch (error) {
      this.logger.error('Report generate error', error);
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

  @Post('save')
  @ApiOperation({ summary: 'Save a generated report' })
  async save(
    @Body() body: {
      title: string; prompt: string; queryType?: string;
      filters?: Record<string, unknown>; results?: unknown;
      chartConfig?: Record<string, unknown>; narrative?: string;
    },
    @Request() req: AuthRequest,
  ) {
    const { tenantId, userId } = req.user;
    return this.reportsService.saveReport(tenantId, userId, body);
  }

  @Get()
  @ApiOperation({ summary: 'List saved reports' })
  async list(@Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    return this.reportsService.listReports(tenantId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a saved report by ID' })
  async getOne(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.reportsService.getReport(req.user.tenantId, id);
  }

  @Post(':id/export')
  @ApiOperation({ summary: 'Export a report as CSV/PDF/Excel' })
  @HttpCode(HttpStatus.OK)
  async exportReport(
    @Param('id') id: string,
    @Body() dto: ExportReportDto,
    @Request() req: AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    const content = await this.reportsService.exportReport(
      req.user.tenantId, id, dto.format,
    );

    const contentType = dto.format === 'csv'
      ? 'text/csv'
      : dto.format === 'excel'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/json';

    void reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="report.${dto.format}"`)
      .send(content);
  }
}

