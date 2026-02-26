import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { RewardsStatementService } from './rewards-statement.service';
import { GenerateStatementDto, BulkGenerateDto, StatementQueryDto } from './dto';
import { FastifyReply } from 'fastify';
import * as fs from 'fs';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('rewards-statements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('rewards-statements')
export class RewardsStatementController {
  private readonly logger = new Logger(RewardsStatementController.name);

  constructor(private readonly service: RewardsStatementService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate a PDF rewards statement for one employee' })
  async generate(@Body() dto: GenerateStatementDto, @Request() req: AuthRequest) {
    this.logger.log(`Generate statement: employee=${dto.employeeId} user=${req.user.userId}`);
    return this.service.generate(req.user.tenantId, dto.employeeId, dto.year);
  }

  @Post('generate-bulk')
  @ApiOperation({ summary: 'Bulk generate PDF statements by department or all' })
  async generateBulk(@Body() dto: BulkGenerateDto, @Request() req: AuthRequest) {
    this.logger.log(`Bulk generate: dept=${dto.department || 'all'} user=${req.user.userId}`);
    return this.service.generateBulk(req.user.tenantId, dto.department, dto.year);
  }

  @Get()
  @ApiOperation({ summary: 'List generated rewards statements' })
  async list(@Query() query: StatementQueryDto, @Request() req: AuthRequest) {
    return this.service.list(req.user.tenantId, query);
  }

  @Get('my')
  @ApiOperation({ summary: 'Get my own rewards statements (employee self-service)' })
  async getMyStatements(@Request() req: AuthRequest) {
    return this.service.getMyStatement(req.user.tenantId, req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific rewards statement' })
  async getById(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.service.getById(req.user.tenantId, id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download the PDF for a rewards statement' })
  async download(@Param('id') id: string, @Request() req: AuthRequest, @Res() reply: FastifyReply) {
    const filePath = await this.service.getDownloadPath(req.user.tenantId, id);
    const stream = fs.createReadStream(filePath);
    const fileName = filePath.split('/').pop() || 'statement.pdf';

    void reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(stream);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Send rewards statement via email (stub)' })
  async sendEmail(@Param('id') id: string, @Request() req: AuthRequest) {
    this.logger.log(`Send statement email: id=${id} user=${req.user.userId}`);
    return this.service.sendEmail(req.user.tenantId, id);
  }
}
