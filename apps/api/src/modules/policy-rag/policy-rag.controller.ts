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
  Req,
  Res,
  Logger,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard, PermissionGuard, RequirePermission } from '../../common';
import { PolicyRagService } from './policy-rag.service';
import { AskPolicyDto, PolicyQueryDto } from './dto';
import { formatSSE } from '@compensation/ai';
import { parseCSV } from '@compensation/shared';
import * as ExcelJS from 'exceljs';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

interface AuthenticatedFastifyRequest extends FastifyRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@RequirePermission('Policy RAG', 'view')
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

  @Post('upload-file')
  @ApiOperation({ summary: 'Upload a policy file (PDF, TXT, CSV, or Excel) via multipart form' })
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.CREATED)
  async uploadFile(@Req() req: AuthenticatedFastifyRequest) {
    const data = await req.file();
    if (!data) {
      throw new BadRequestException('No file uploaded. Send a multipart form with a "file" field.');
    }

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer);
    }
    const fileBuffer = Buffer.concat(chunks);

    if (fileBuffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty.');
    }

    const fileName = data.filename;
    const mimeType = data.mimetype;
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));

    // Validate file type
    const allowedExts = ['.pdf', '.txt', '.csv', '.tsv', '.xlsx', '.xls', '.md'];
    if (!allowedExts.includes(ext)) {
      throw new BadRequestException(
        `Unsupported file type: ${ext}. Use PDF, TXT, CSV, or Excel (.xlsx).`,
      );
    }

    // Extract text content from the file
    const content = await this.extractTextFromFile(fileBuffer, fileName, mimeType);
    const title = fileName.replace(/\.[^.]+$/, '');

    const { tenantId, userId } = req.user;
    this.logger.log(`Policy file upload: user=${userId} tenant=${tenantId} file=${fileName}`);

    return this.policyRagService.uploadDocument(
      tenantId,
      userId,
      title,
      fileName,
      content,
      mimeType,
    );
  }

  /**
   * Extract text content from uploaded files of various formats.
   */
  private async extractTextFromFile(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));

    // PDF
    if (ext === '.pdf' || mimeType === 'application/pdf') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfParse = ((await import('pdf-parse' as any)) as any).default as (
          buf: Buffer,
        ) => Promise<{ text: string }>;
        const data = await pdfParse(buffer);
        return data.text;
      } catch {
        throw new BadRequestException('PDF parsing failed. Try uploading a .txt file instead.');
      }
    }

    // CSV / TSV
    if (ext === '.csv' || ext === '.tsv' || mimeType === 'text/csv') {
      const text = buffer.toString('utf-8');
      const parsed = parseCSV(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        throw new BadRequestException('CSV file is empty or has no data.');
      }
      // Convert to markdown table for the RAG chunker
      const headerLine = `| ${parsed.headers.join(' | ')} |`;
      const separator = `| ${parsed.headers.map(() => '---').join(' | ')} |`;
      const dataLines = parsed.rows.map(
        (row) => `| ${parsed.headers.map((_, i) => row[i]?.trim() ?? '').join(' | ')} |`,
      );
      return [headerLine, separator, ...dataLines].join('\n');
    }

    // Excel
    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount < 2) {
        throw new BadRequestException('Excel file has no data.');
      }
      const headers: string[] = [];
      sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
        headers[col - 1] = String(cell.value ?? '').trim();
      });
      const rows: string[] = [];
      for (let r = 2; r <= sheet.rowCount; r++) {
        const row = sheet.getRow(r);
        const cells = headers.map((_, c) => String(row.getCell(c + 1).value ?? '').trim());
        if (cells.some((v) => v !== '')) {
          rows.push(`| ${cells.join(' | ')} |`);
        }
      }
      const headerLine = `| ${headers.join(' | ')} |`;
      const separator = `| ${headers.map(() => '---').join(' | ')} |`;
      return [headerLine, separator, ...rows].join('\n');
    }

    // Plain text / markdown — just decode
    return buffer.toString('utf-8');
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
