import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  Req,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard, RolesGuard, Roles } from '../../common';
import { PolicyConverterService } from './services/policy-converter.service';
import { RuleSetCrudService, RuleCrudService } from './services/rules-crud.service';
import { SimulatorService } from './services/simulator.service';
import { TestGeneratorService } from './services/test-generator.service';
import { TestRunnerService } from './services/test-runner.service';
import { RuleGeneratorService } from './services/rule-generator.service';
import { LlmRuleGeneratorService } from './services/llm-rule-generator.service';
import { RuleUploadService } from './services/rule-upload.service';
import {
  ConvertPolicyDto,
  UpdateConversionCountsDto,
  CreateRuleSetDto,
  UpdateRuleSetDto,
  CreateRuleDto,
  UpdateRuleDto,
  RuleSetQueryDto,
  SimulationParamsDto,
  GenerateRulesDto,
  LlmAnalyzeDto,
  LlmGenerateDto,
  ApproveRuleUploadDto,
} from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

interface AuthenticatedFastifyRequest extends FastifyRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('rules')
export class RulesController {
  constructor(
    private readonly policyConverter: PolicyConverterService,
    private readonly ruleSetCrud: RuleSetCrudService,
    private readonly ruleCrud: RuleCrudService,
    private readonly simulatorService: SimulatorService,
    private readonly testGeneratorService: TestGeneratorService,
    private readonly testRunnerService: TestRunnerService,
    private readonly ruleGenerator: RuleGeneratorService,
    private readonly llmRuleGenerator: LlmRuleGeneratorService,
    private readonly ruleUploadService: RuleUploadService,
  ) {}

  // ─── Policy Conversion ─────────────────────────────────────────

  @Post('convert-policy')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({ summary: 'Convert a natural language policy document into structured rules' })
  async convertPolicy(@Body() dto: ConvertPolicyDto, @Request() req: AuthRequest) {
    return this.policyConverter.convertPolicy(
      dto.text,
      req.user.tenantId,
      req.user.userId,
      dto.fileName,
      dto.fileType,
    );
  }

  @Post('convert-policy/upload')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({
    summary: 'Upload a PDF, TXT, CSV, or Excel file and convert to structured rules',
  })
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.OK)
  async convertPolicyUpload(@Req() req: AuthenticatedFastifyRequest) {
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

    // Allow PDF, text, CSV, and Excel files
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/csv',
      'text/tab-separated-values',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    const allowedExts = ['.pdf', '.txt', '.csv', '.tsv', '.xlsx', '.xls'];
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    if (!allowedTypes.includes(mimeType) && !allowedExts.includes(ext)) {
      throw new BadRequestException('Unsupported file type. Use PDF, TXT, CSV, or Excel (.xlsx).');
    }

    const policyText = await this.policyConverter.extractText(fileBuffer, fileName, mimeType);

    return this.policyConverter.convertPolicy(
      policyText,
      req.user.tenantId,
      req.user.userId,
      fileName,
      mimeType,
    );
  }

  @Get('conversion-history')
  @ApiOperation({ summary: 'Get policy conversion history for the tenant' })
  async getConversionHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Request() req?: AuthRequest,
  ) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10) || 20));
    return this.policyConverter.getConversionHistory(req!.user.tenantId, pageNum, limitNum);
  }

  @Patch('conversions/:id/counts')
  @ApiOperation({ summary: 'Update accepted/rejected counts for a conversion' })
  async updateConversionCounts(@Param('id') id: string, @Body() dto: UpdateConversionCountsDto) {
    return this.policyConverter.updateConversionCounts(id, dto.accepted, dto.rejected);
  }

  // ─── Rule Set CRUD ────────────────────────────────────────────

  @Post('rule-sets')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({ summary: 'Create a new rule set' })
  async createRuleSet(@Body() dto: CreateRuleSetDto, @Request() req: AuthRequest) {
    return this.ruleSetCrud.createRuleSet(req.user.tenantId, dto);
  }

  @Get('rule-sets')
  @ApiOperation({ summary: 'List rule sets with optional filters' })
  async listRuleSets(@Query() query: RuleSetQueryDto, @Request() req: AuthRequest) {
    return this.ruleSetCrud.getRuleSets(
      req.user.tenantId,
      { page: query.page, limit: query.limit },
      query.status,
    );
  }

  @Get('rule-sets/:id')
  @ApiOperation({ summary: 'Get a rule set with its rules' })
  async getRuleSet(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.ruleSetCrud.getRuleSet(req.user.tenantId, id);
  }

  @Patch('rule-sets/:id')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({ summary: 'Update a rule set' })
  async updateRuleSet(
    @Param('id') id: string,
    @Body() dto: UpdateRuleSetDto,
    @Request() req: AuthRequest,
  ) {
    return this.ruleSetCrud.update(req.user.tenantId, id, { ...dto });
  }

  @Delete('rule-sets/:id')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({ summary: 'Delete a rule set' })
  async deleteRuleSet(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.ruleSetCrud.delete(req.user.tenantId, id);
  }

  // ─── Rule CRUD ────────────────────────────────────────────────

  @Post('rule-sets/:ruleSetId/rules')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({ summary: 'Add a rule to a rule set' })
  async addRule(
    @Param('ruleSetId') ruleSetId: string,
    @Body() dto: CreateRuleDto,
    @Request() req: AuthRequest,
  ) {
    return this.ruleCrud.addRule(req.user.tenantId, ruleSetId, dto);
  }

  @Patch('rule-sets/:ruleSetId/rules/:ruleId')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({ summary: 'Update a rule' })
  async updateRule(
    @Param('ruleSetId') ruleSetId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateRuleDto,
    @Request() req: AuthRequest,
  ) {
    return this.ruleCrud.updateRule(req.user.tenantId, ruleSetId, ruleId, { ...dto });
  }

  @Delete('rule-sets/:ruleSetId/rules/:ruleId')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({ summary: 'Delete a rule from a rule set' })
  async deleteRule(
    @Param('ruleSetId') ruleSetId: string,
    @Param('ruleId') ruleId: string,
    @Request() req: AuthRequest,
  ) {
    return this.ruleCrud.deleteRule(req.user.tenantId, ruleSetId, ruleId);
  }

  // ─── Simulation ──────────────────────────────────────────────

  @Post('rule-sets/:ruleSetId/simulate')
  @ApiOperation({ summary: 'Run a sandbox simulation of a rule set against employees' })
  async runSimulation(
    @Param('ruleSetId') ruleSetId: string,
    @Body() params: SimulationParamsDto,
    @Request() req: AuthRequest,
  ) {
    return this.simulatorService.runSimulation(
      req.user.tenantId,
      req.user.userId,
      ruleSetId,
      params,
    );
  }

  @Get('rule-sets/:ruleSetId/simulations/:id')
  @ApiOperation({ summary: 'Get simulation results by ID' })
  async getSimulation(
    @Param('ruleSetId') _ruleSetId: string,
    @Param('id') id: string,
    @Request() req: AuthRequest,
  ) {
    return this.simulatorService.getSimulation(req.user.tenantId, id);
  }

  // ─── Test Cases ──────────────────────────────────────────────

  @Post('rule-sets/:ruleSetId/generate-tests')
  @ApiOperation({ summary: 'Auto-generate test cases for a rule set' })
  async generateTests(@Param('ruleSetId') ruleSetId: string, @Request() req: AuthRequest) {
    const testCases = await this.testGeneratorService.generateTestCases(
      req.user.tenantId,
      ruleSetId,
    );
    return { generated: testCases.length, testCases };
  }

  @Get('rule-sets/:ruleSetId/test-cases')
  @ApiOperation({ summary: 'List test cases for a rule set' })
  async listTestCases(
    @Param('ruleSetId') ruleSetId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10) || 20));
    return this.testRunnerService.listTestCases(ruleSetId, pageNum, limitNum);
  }

  @Post('rule-sets/:ruleSetId/test-cases/run')
  @ApiOperation({ summary: 'Execute all test cases for a rule set' })
  async runTestCases(@Param('ruleSetId') ruleSetId: string, @Request() req: AuthRequest) {
    return this.testRunnerService.runTestCases(req.user.tenantId, ruleSetId);
  }

  // ─── AI Rule Generation ──────────────────────────────────────

  @Post('rule-sets/:ruleSetId/generate')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({ summary: 'Clone a rule set and apply AI-based adjustments for a new cycle' })
  async generateRules(
    @Param('ruleSetId') ruleSetId: string,
    @Body() dto: GenerateRulesDto,
    @Request() req: AuthRequest,
  ) {
    return this.ruleGenerator.generateFromSource(req.user.tenantId, {
      sourceRuleSetId: ruleSetId,
      ...dto,
    });
  }

  // ─── LLM Rule Analysis & Generation ──────────────────────

  @Post('rule-sets/:ruleSetId/analyze')
  @ApiOperation({
    summary: 'Analyse a rule set using AI — returns plain English explanation',
  })
  async analyzeRuleSet(
    @Param('ruleSetId') ruleSetId: string,
    @Body() dto: LlmAnalyzeDto,
    @Request() req: AuthRequest,
  ) {
    if (dto.compareWithId) {
      const analysis = await this.llmRuleGenerator.compareRuleSets(
        req.user.tenantId,
        req.user.userId,
        ruleSetId,
        dto.compareWithId,
        req.user.role,
      );
      return { analysis };
    }
    const analysis = await this.llmRuleGenerator.analyzeRuleSet(
      req.user.tenantId,
      req.user.userId,
      ruleSetId,
      req.user.role,
    );
    return { analysis };
  }

  @Post('generate-from-instruction')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({
    summary: 'Generate compensation rules from a natural language instruction using AI',
  })
  async generateFromInstruction(@Body() dto: LlmGenerateDto, @Request() req: AuthRequest) {
    const result = await this.llmRuleGenerator.generateFromInstruction(
      req.user.tenantId,
      req.user.userId,
      dto.instruction,
      req.user.role,
    );
    return { result };
  }

  // ─── Rule Upload (CSV / Excel) ───────────────────────────

  @Post('upload')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({ summary: 'Upload a CSV or Excel file containing compensation rules' })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({
    name: 'ai',
    required: false,
    type: Boolean,
    description: 'Enable AI-powered column mapping suggestions',
  })
  @HttpCode(HttpStatus.OK)
  async uploadRules(@Req() req: AuthenticatedFastifyRequest, @Query('ai') ai?: string) {
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

    const allowedExts = ['.csv', '.tsv', '.txt', '.xlsx', '.xls'];
    const ext = data.filename.toLowerCase().slice(data.filename.lastIndexOf('.'));
    if (!allowedExts.includes(ext)) {
      throw new BadRequestException(`Unsupported file type: ${ext}. Use CSV or Excel (.xlsx).`);
    }

    const aiMapping = ai === 'true' || ai === '1';

    return this.ruleUploadService.parseUpload(
      req.user.tenantId,
      req.user.userId,
      data.filename,
      fileBuffer,
      aiMapping,
    );
  }

  @Post('upload/:uploadId/approve')
  @Roles('ADMIN', 'HR_MANAGER')
  @ApiOperation({ summary: 'Approve a previewed rule upload and persist as a new RuleSet' })
  @HttpCode(HttpStatus.CREATED)
  async approveUpload(
    @Param('uploadId') uploadId: string,
    @Body() dto: ApproveRuleUploadDto,
    @Request() req: AuthRequest,
  ) {
    return this.ruleUploadService.approveUpload(req.user.tenantId, uploadId, dto.ruleSetName);
  }
}
