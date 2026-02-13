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
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
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
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('letters')
export class LettersController {
  private readonly logger = new Logger(LettersController.name);

  constructor(private readonly lettersService: LettersService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate a compensation letter for an employee' })
  @HttpCode(HttpStatus.CREATED)
  async generate(
    @Body() dto: GenerateLetterDto,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, userId } = req.user;
    this.logger.log(`Generate letter: type=${dto.letterType} employee=${dto.employeeId} user=${userId}`);
    return this.lettersService.generateLetter(tenantId, userId, dto);
  }

  @Post('generate-batch')
  @ApiOperation({ summary: 'Generate compensation letters for multiple employees' })
  @HttpCode(HttpStatus.CREATED)
  async generateBatch(
    @Body() dto: GenerateBatchLetterDto,
    @Request() req: AuthRequest,
  ) {
    const { tenantId, userId } = req.user;
    this.logger.log(`Batch generate: type=${dto.letterType} count=${dto.employeeIds.length} user=${userId}`);
    return this.lettersService.generateBatch(tenantId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List generated compensation letters' })
  async list(
    @Query() dto: ListLettersDto,
    @Request() req: AuthRequest,
  ) {
    const { tenantId } = req.user;
    return this.lettersService.listLetters(tenantId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific compensation letter' })
  async getById(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId } = req.user;
    return this.lettersService.getLetterById(tenantId, id);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Get letter data for PDF generation' })
  async getPdf(
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    const { tenantId } = req.user;
    return this.lettersService.getLetterPdf(tenantId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a compensation letter (edit before sending)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLetterDto,
    @Request() req: AuthRequest,
  ) {
    const { tenantId } = req.user;
    this.logger.log(`Update letter: id=${id} user=${req.user.userId}`);
    return this.lettersService.updateLetter(tenantId, id, dto);
  }
}

