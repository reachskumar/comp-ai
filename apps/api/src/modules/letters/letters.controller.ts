import {
  Controller,
  Post,
  Get,
  Put,
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
import { Throttle } from '@nestjs/throttler';
import { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard, PermissionGuard, RequirePermission } from '../../common';
import { LettersService } from './letters.service';
import { GenerateLetterDto } from './dto/generate-letter.dto';
import { GenerateBatchLetterDto } from './dto/generate-batch-letter.dto';
import { UpdateLetterDto } from './dto/update-letter.dto';
import { ListLettersDto } from './dto/list-letters.dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('letters')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@RequirePermission('Letters', 'view')
@Controller('letters')
export class LettersController {
  private readonly logger = new Logger(LettersController.name);

  constructor(private readonly lettersService: LettersService) {}

  // ─── Generation ──────────────────────────────────────────────
  // Each letter is one paid LLM call. Throttle per-user to bound spend.

  @Post('generate')
  @ApiOperation({ summary: 'Generate a compensation letter for an employee' })
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('Letters', 'insert')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async generate(@Body() dto: GenerateLetterDto, @Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    this.logger.log(
      `Generate letter: type=${dto.letterType} employee=${dto.employeeId} user=${userId}`,
    );
    return this.lettersService.generateLetter(tenantId, userId, dto);
  }

  @Post('generate-batch')
  @ApiOperation({
    summary: 'Enqueue a batch of compensation letters; returns batchId immediately.',
  })
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermission('Letters', 'insert')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async generateBatch(@Body() dto: GenerateBatchLetterDto, @Request() req: AuthRequest) {
    const { tenantId, userId } = req.user;
    this.logger.log(
      `Batch enqueue: type=${dto.letterType} count=${dto.employeeIds.length} user=${userId}`,
    );
    return this.lettersService.enqueueBatch(tenantId, userId, dto);
  }

  @Get('batches/:batchId/progress')
  @ApiOperation({ summary: 'Get progress for an enqueued batch (poll-friendly).' })
  async batchProgress(@Param('batchId') batchId: string, @Request() req: AuthRequest) {
    const { tenantId } = req.user;
    return this.lettersService.getBatchProgress(tenantId, batchId);
  }

  // ─── Read ────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List generated compensation letters' })
  async list(@Query() dto: ListLettersDto, @Request() req: AuthRequest) {
    const { tenantId } = req.user;
    return this.lettersService.listLetters(tenantId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific compensation letter' })
  async getById(@Param('id') id: string, @Request() req: AuthRequest) {
    const { tenantId } = req.user;
    return this.lettersService.getLetterById(tenantId, id);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download letter as PDF' })
  async getPdf(@Param('id') id: string, @Request() req: AuthRequest, @Res() reply: FastifyReply) {
    const { tenantId } = req.user;
    const { buffer, fileName } = await this.lettersService.getLetterPdfWithName(tenantId, id);
    void reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(buffer);
  }

  // ─── Mutate ──────────────────────────────────────────────────

  @Put(':id')
  @ApiOperation({ summary: 'Update a compensation letter (edit before sending)' })
  @RequirePermission('Letters', 'update')
  async update(@Param('id') id: string, @Body() dto: UpdateLetterDto, @Request() req: AuthRequest) {
    const { tenantId } = req.user;
    this.logger.log(`Update letter: id=${id} user=${req.user.userId}`);
    return this.lettersService.updateLetter(tenantId, id, dto);
  }
}
