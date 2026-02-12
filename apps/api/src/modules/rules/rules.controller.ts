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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { PolicyConverterService } from './services/policy-converter.service';
import { RuleSetCrudService, RuleCrudService } from './services/rules-crud.service';
import { SimulatorService } from './services/simulator.service';
import { TestGeneratorService } from './services/test-generator.service';
import { TestRunnerService } from './services/test-runner.service';
import {
  ConvertPolicyDto,
  CreateRuleSetDto,
  UpdateRuleSetDto,
  CreateRuleDto,
  UpdateRuleDto,
  RuleSetQueryDto,
  SimulationParamsDto,
} from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('api/v1/rules')
export class RulesController {
  constructor(
    private readonly policyConverter: PolicyConverterService,
    private readonly ruleSetCrud: RuleSetCrudService,
    private readonly ruleCrud: RuleCrudService,
    private readonly simulatorService: SimulatorService,
    private readonly testGeneratorService: TestGeneratorService,
    private readonly testRunnerService: TestRunnerService,
  ) {}

  // ─── Policy Conversion ─────────────────────────────────────────

  @Post('convert-policy')
  @ApiOperation({ summary: 'Convert a natural language policy document into structured rules' })
  async convertPolicy(@Body() dto: ConvertPolicyDto, @Request() req: AuthRequest) {
    return this.policyConverter.convertPolicy(dto.text, req.user.tenantId, req.user.userId);
  }

  // ─── Rule Set CRUD ────────────────────────────────────────────

  @Post('rule-sets')
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
  @ApiOperation({ summary: 'Update a rule set' })
  async updateRuleSet(
    @Param('id') id: string,
    @Body() dto: UpdateRuleSetDto,
    @Request() req: AuthRequest,
  ) {
    return this.ruleSetCrud.update(req.user.tenantId, id, { ...dto });
  }

  @Delete('rule-sets/:id')
  @ApiOperation({ summary: 'Delete a rule set' })
  async deleteRuleSet(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.ruleSetCrud.delete(req.user.tenantId, id);
  }

  // ─── Rule CRUD ────────────────────────────────────────────────

  @Post('rule-sets/:ruleSetId/rules')
  @ApiOperation({ summary: 'Add a rule to a rule set' })
  async addRule(
    @Param('ruleSetId') ruleSetId: string,
    @Body() dto: CreateRuleDto,
    @Request() req: AuthRequest,
  ) {
    return this.ruleCrud.addRule(req.user.tenantId, ruleSetId, dto);
  }

  @Patch('rule-sets/:ruleSetId/rules/:ruleId')
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
  async generateTests(
    @Param('ruleSetId') ruleSetId: string,
    @Request() req: AuthRequest,
  ) {
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
  async runTestCases(
    @Param('ruleSetId') ruleSetId: string,
    @Request() req: AuthRequest,
  ) {
    return this.testRunnerService.runTestCases(req.user.tenantId, ruleSetId);
  }
}

