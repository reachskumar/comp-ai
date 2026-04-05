import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformConfigService } from '../services/platform-config.service';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

/**
 * Platform Configuration Controller — PLATFORM_ADMIN only.
 *
 * Manage all platform settings from the UI:
 * - AI model configuration (provider, models per tier, temperature, tokens)
 * - Market data provider API keys
 * - Integration defaults
 * - Security settings
 * - Feature flags
 */
@ApiTags('platform-admin / configuration')
@Controller('platform-admin/config')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@ApiBearerAuth()
export class PlatformConfigController {
  private readonly logger = new Logger(PlatformConfigController.name);

  constructor(private readonly configService: PlatformConfigService) {}

  // ─── Browse ──────────────────────────────────────────────

  @Get('categories')
  @ApiOperation({ summary: 'List all configuration categories' })
  async getCategories() {
    const categories = await this.configService.getAllCategories();
    return { categories };
  }

  @Get(':category')
  @ApiOperation({ summary: 'Get all settings in a category' })
  async getCategory(@Param('category') category: string) {
    const settings = await this.configService.getCategory(category);
    return { category, settings };
  }

  @Get(':category/:key')
  @ApiOperation({ summary: 'Get a single setting value' })
  async getValue(
    @Param('category') category: string,
    @Param('key') key: string,
  ) {
    const value = await this.configService.get(category, key);
    // Check if it's a secret
    const settings = await this.configService.getCategory(category);
    const setting = settings.find((s) => s.key === key);
    return {
      category,
      key,
      value: setting?.isSecret ? '••••••••' : value,
      isSecret: setting?.isSecret ?? false,
      description: setting?.description ?? null,
    };
  }

  // ─── Update ──────────────────────────────────────────────

  @Put(':category/:key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a configuration value' })
  async setValue(
    @Param('category') category: string,
    @Param('key') key: string,
    @Body() body: { value: string; isSecret?: boolean; description?: string },
    @Request() req: AuthRequest,
  ) {
    await this.configService.set(category, key, body.value, {
      isSecret: body.isSecret,
      description: body.description,
      updatedBy: req.user.userId,
    });

    this.logger.log(`Config ${category}.${key} updated by ${req.user.email}`);
    return { category, key, updated: true };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk update multiple settings' })
  async bulkSet(
    @Body() body: {
      settings: Array<{
        category: string;
        key: string;
        value: string;
        isSecret?: boolean;
        description?: string;
      }>;
    },
    @Request() req: AuthRequest,
  ) {
    const count = await this.configService.bulkSet(body.settings, req.user.userId);
    return { updated: count };
  }

  @Delete(':category/:key')
  @ApiOperation({ summary: 'Delete a configuration entry' })
  async deleteValue(
    @Param('category') category: string,
    @Param('key') key: string,
  ) {
    const deleted = await this.configService.delete(category, key);
    return { category, key, deleted };
  }

  // ─── Validation ──────────────────────────────────────────

  @Get('validate/ai')
  @ApiOperation({ summary: 'Validate AI configuration (check API keys, models)' })
  async validateAI() {
    return this.configService.validateAIConfig();
  }

  @Get('validate/market-data/:providerType')
  @ApiOperation({ summary: 'Validate market data provider configuration' })
  async validateMarketData(@Param('providerType') providerType: string) {
    return this.configService.validateMarketDataConfig(providerType);
  }

  // ─── Presets ─────────────────────────────────────────────

  @Get('presets/ai')
  @ApiOperation({ summary: 'Get AI configuration presets (available models, tiers, defaults)' })
  getAIPresets() {
    return {
      providers: [
        { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini'] },
        { id: 'azure', name: 'Azure OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
        { id: 'anthropic', name: 'Anthropic', models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'] },
      ],
      tiers: [
        {
          id: 'reasoning',
          name: 'Reasoning (Tier 1)',
          description: 'Complex financial analysis — Compliance, Simulation, Budget Optimizer, Calibration, Anomaly',
          recommended: 'gpt-4o or claude-sonnet-4',
        },
        {
          id: 'interactive',
          name: 'Interactive (Tier 2)',
          description: 'Real-time chat — Copilot, Policy RAG',
          recommended: 'gpt-4o-mini',
        },
        {
          id: 'batch',
          name: 'Batch (Tier 3)',
          description: 'Background processing — Letters, Field Mapping, Reports, Data Quality',
          recommended: 'gpt-4o-mini',
        },
      ],
      settingsSchema: [
        { key: 'provider', type: 'select', options: ['openai', 'azure', 'anthropic'], label: 'AI Provider' },
        { key: 'default_model', type: 'select', options: ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-20250514'], label: 'Default Model' },
        { key: 'model_reasoning', type: 'select', options: ['gpt-4o', 'claude-sonnet-4-20250514', ''], label: 'Reasoning Tier Model' },
        { key: 'model_interactive', type: 'select', options: ['gpt-4o', 'gpt-4o-mini', 'claude-haiku-4-5-20251001', ''], label: 'Interactive Tier Model' },
        { key: 'model_batch', type: 'select', options: ['gpt-4o-mini', 'claude-haiku-4-5-20251001', ''], label: 'Batch Tier Model' },
        { key: 'openai_api_key', type: 'secret', label: 'OpenAI API Key' },
        { key: 'azure_api_key', type: 'secret', label: 'Azure OpenAI API Key' },
        { key: 'azure_endpoint', type: 'text', label: 'Azure OpenAI Endpoint' },
        { key: 'azure_deployment', type: 'text', label: 'Azure Deployment Name' },
        { key: 'anthropic_api_key', type: 'secret', label: 'Anthropic API Key' },
        { key: 'temperature_default', type: 'number', label: 'Default Temperature', min: 0, max: 1 },
        { key: 'max_tokens_default', type: 'number', label: 'Default Max Tokens', min: 256, max: 8192 },
        { key: 'monthly_budget_cents', type: 'number', label: 'Monthly AI Budget per Tenant (cents)', min: 0 },
      ],
    };
  }

  @Get('presets/market-data')
  @ApiOperation({ summary: 'Get market data provider presets (available providers, required fields)' })
  getMarketDataPresets() {
    return {
      providers: [
        { id: 'BLS_OES', name: 'US Bureau of Labor Statistics', region: 'US', cost: 'Free', fields: [{ key: 'bls_api_key', type: 'text', label: 'BLS API Key (optional)', required: false }] },
        { id: 'MERCER_TRS', name: 'Mercer Total Remuneration Survey', region: 'Global (130+ countries)', cost: 'Enterprise', fields: [{ key: 'mercer_api_url', type: 'text', label: 'API URL', required: true }, { key: 'mercer_api_key', type: 'secret', label: 'API Key', required: true }, { key: 'mercer_survey_id', type: 'text', label: 'Survey ID', required: true }] },
        { id: 'SALARY_COM', name: 'Salary.com CompAnalyst', region: 'US-primary', cost: 'Paid', fields: [{ key: 'salarycom_api_url', type: 'text', label: 'API URL', required: true }, { key: 'salarycom_api_key', type: 'secret', label: 'API Key', required: true }, { key: 'salarycom_client_id', type: 'text', label: 'Client ID', required: true }] },
        { id: 'PAYSCALE', name: 'PayScale', region: 'Global (100+ countries)', cost: 'Paid', fields: [{ key: 'payscale_api_key', type: 'secret', label: 'API Key', required: true }] },
        { id: 'RADFORD', name: 'Radford (Aon)', region: 'Global Tech', cost: 'Enterprise', fields: [{ key: 'radford_api_url', type: 'text', label: 'API URL', required: true }, { key: 'radford_api_key', type: 'secret', label: 'API Key', required: true }] },
        { id: 'KORN_FERRY', name: 'Korn Ferry Hay Group', region: 'Global', cost: 'Enterprise', fields: [{ key: 'kornferry_api_url', type: 'text', label: 'API URL', required: true }, { key: 'kornferry_api_key', type: 'secret', label: 'API Key', required: true }, { key: 'kornferry_client_id', type: 'text', label: 'Client ID', required: true }] },
        { id: 'GLASSDOOR', name: 'Glassdoor', region: 'Global', cost: 'Partner API', fields: [{ key: 'glassdoor_partner_id', type: 'text', label: 'Partner ID', required: true }, { key: 'glassdoor_api_key', type: 'secret', label: 'API Key', required: true }] },
        { id: 'NAUKRI', name: 'Naukri / InfoEdge', region: 'India', cost: 'Paid', fields: [{ key: 'naukri_api_url', type: 'text', label: 'API URL', required: true }, { key: 'naukri_api_key', type: 'secret', label: 'API Key', required: true }] },
        { id: 'ERI', name: 'Economic Research Institute', region: 'US/Canada', cost: 'Paid', fields: [{ key: 'eri_api_url', type: 'text', label: 'API URL', required: true }, { key: 'eri_api_key', type: 'secret', label: 'API Key', required: true }] },
        { id: 'HAYS', name: 'Hays Salary Guide', region: 'UK/Europe/APAC', cost: 'Paid', fields: [{ key: 'hays_api_url', type: 'text', label: 'API URL', required: true }, { key: 'hays_api_key', type: 'secret', label: 'API Key', required: true }] },
      ],
    };
  }

  @Get('presets/features')
  @ApiOperation({ summary: 'Get available feature flags' })
  getFeaturePresets() {
    return {
      flags: [
        { key: 'copilot_enabled', label: 'AI Copilot', description: 'Enable conversational AI assistant', default: true },
        { key: 'compliance_scanner_enabled', label: 'Compliance Scanner', description: 'Enable AI compliance scanning', default: true },
        { key: 'pay_equity_enabled', label: 'Pay Equity Analysis', description: 'Enable pay equity reporting', default: true },
        { key: 'simulation_enabled', label: 'What-If Simulation', description: 'Enable compensation simulation', default: true },
        { key: 'policy_rag_enabled', label: 'Policy Q&A', description: 'Enable policy document AI search', default: true },
        { key: 'attrition_predictor_enabled', label: 'Attrition Predictor', description: 'Enable retention risk scoring', default: false },
        { key: 'budget_optimizer_enabled', label: 'Budget Optimizer', description: 'Enable AI budget optimization', default: false },
        { key: 'letter_generator_enabled', label: 'Letter Generator', description: 'Enable AI letter generation', default: true },
        { key: 'benchmarking_enabled', label: 'Market Benchmarking', description: 'Enable salary benchmarking', default: true },
        { key: 'write_back_enabled', label: 'Write-Back to Compport', description: 'Enable write-back of AI recommendations', default: true },
      ],
    };
  }
}
