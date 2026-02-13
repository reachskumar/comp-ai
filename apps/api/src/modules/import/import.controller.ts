import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import * as fs from 'fs';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { ImportService } from './import.service';
import { ImportQueryDto } from './dto/import-query.dto';
import { ApproveImportDto } from './dto/approve-import.dto';

interface AuthenticatedRequest extends FastifyRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('imports')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a CSV file for import' })
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.CREATED)
  async upload(@Req() req: AuthenticatedRequest) {
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
      throw new BadRequestException('Uploaded file is empty');
    }

    const result = await this.importService.upload(
      req.user.tenantId,
      req.user.userId,
      data.filename,
      fileBuffer,
    );

    return result;
  }

  @Get(':id/analyze')
  @ApiOperation({ summary: 'Run or get analysis for an import job' })
  async analyze(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importService.getAnalysis(id, req.user.tenantId);
  }

  @Post(':id/clean')
  @ApiOperation({ summary: 'Run cleaning pipeline on an import job' })
  @HttpCode(HttpStatus.OK)
  async clean(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importService.clean(id, req.user.tenantId);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve and persist cleaned import data' })
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id') id: string,
    @Body() _dto: ApproveImportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importService.approve(id, req.user.tenantId);
  }

  @Get()
  @ApiOperation({ summary: 'List import jobs (paginated)' })
  async list(
    @Query() query: ImportQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importService.list(req.user.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get import job details with issues' })
  async getById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importService.getById(id, req.user.tenantId);
  }

  @Get(':id/download/cleaned')
  @ApiOperation({ summary: 'Download cleaned CSV file' })
  async downloadCleaned(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ) {
    const filePath = await this.importService.getCleanedFilePath(id, req.user.tenantId);
    const stream = fs.createReadStream(filePath);
    void reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="cleaned-${id}.csv"`)
      .send(stream);
  }

  @Get(':id/download/rejects')
  @ApiOperation({ summary: 'Download rejects CSV file' })
  async downloadRejects(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Res() reply: FastifyReply,
  ) {
    const filePath = await this.importService.getRejectsFilePath(id, req.user.tenantId);
    const stream = fs.createReadStream(filePath);
    void reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="rejects-${id}.csv"`)
      .send(stream);
  }

  // ─── AI Data Quality Endpoints ──────────────────────────────

  @Post(':id/ai-analyze')
  @ApiOperation({ summary: 'Trigger AI-powered data quality analysis' })
  @HttpCode(HttpStatus.OK)
  async aiAnalyze(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importService.triggerAIAnalysis(id, req.user.tenantId, req.user.userId);
  }

  @Get(':id/ai-report')
  @ApiOperation({ summary: 'Get AI quality report for an import job' })
  async aiReport(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.importService.getAIReport(id, req.user.tenantId);
  }

  @Post(':id/ai-fix')
  @ApiOperation({ summary: 'Apply AI-suggested fixes to import data' })
  @HttpCode(HttpStatus.OK)
  async aiFix(
    @Param('id') id: string,
    @Body() body: { fixes: Array<{ row: number; column: string; suggestedValue: string }> },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!body.fixes || !Array.isArray(body.fixes)) {
      throw new BadRequestException('Request body must include a "fixes" array');
    }
    return this.importService.applyAIFix(id, req.user.tenantId, body.fixes);
  }
}

