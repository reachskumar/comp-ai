/**
 * AI configuration — model settings and environment-based API key.
 * Supports both OpenAI and Azure OpenAI providers via AI_PROVIDER env var.
 */

export type AIProvider = 'openai' | 'azure' | 'anthropic';

export interface ModelConfig {
  /** Model name / deployment name (e.g. "gpt-4o") */
  model: string;
  /** Sampling temperature */
  temperature: number;
  /** Maximum tokens in response */
  maxTokens: number;
}

export interface AzureConfig {
  /** Azure OpenAI endpoint (e.g. "https://myorg.openai.azure.com") */
  endpoint: string;
  /** Azure OpenAI API key */
  apiKey: string;
  /** Azure OpenAI deployment name (e.g. "gpt-4o") */
  deploymentName: string;
  /** Azure OpenAI API version (e.g. "2024-08-01-preview") */
  apiVersion: string;
}

export interface AIConfig {
  /** Which provider to use: 'openai' or 'azure' */
  provider: AIProvider;
  /** OpenAI API key (used when provider = 'openai') */
  apiKey: string;
  /** Azure-specific config (used when provider = 'azure') */
  azure?: AzureConfig;
  /** Default model configuration */
  defaultModel: ModelConfig;
  /** Per-graph-type overrides */
  graphModels: Record<string, Partial<ModelConfig>>;
}

/**
 * Model tiers for cost/quality optimization across agents.
 *
 * Tier 1 (REASONING): Complex financial analysis, compliance, multi-step planning
 *   → Best available model (Claude Opus 4)
 *
 * Tier 2 (INTERACTIVE): Real-time chat, streaming, tool-calling Q&A
 *   → Claude Opus 4 (best instruction following + no hallucination)
 *
 * Tier 3 (BATCH): Background processing, template generation, simple classification
 *   → Claude Opus 4 (unified model for consistency)
 */
export type ModelTier = 'reasoning' | 'interactive' | 'batch';

const GRAPH_TIER_MAP: Record<string, ModelTier> = {
  // Tier 1: Reasoning — complex financial/regulatory analysis
  'compliance-scanner': 'reasoning',
  simulation: 'reasoning',
  'budget-optimizer': 'reasoning',
  'calibration-assistant': 'reasoning',
  'anomaly-explainer': 'reasoning',

  // Tier 2: Interactive — user-facing, latency-sensitive
  copilot: 'interactive',
  'policy-rag': 'interactive',

  // Tier 3: Batch — background, cost-sensitive
  'field-mapping': 'batch',
  'letter-generator': 'batch',
  'data-quality': 'batch',
  'attrition-predictor': 'batch',
  'pay-equity': 'batch',
  'report-builder': 'batch',
  echo: 'batch',
};

/** Default model configurations per graph type */
const GRAPH_MODEL_DEFAULTS: Record<string, Partial<ModelConfig>> = {
  'policy-parser': { temperature: 0.1, maxTokens: 4096 },
  'test-generator': { temperature: 0.3, maxTokens: 2048 },
  simulation: { temperature: 0.0, maxTokens: 4096 },
  'cycle-advisor': { temperature: 0.2, maxTokens: 2048 },
  'anomaly-explainer': { temperature: 0.1, maxTokens: 2048 },
  'data-quality': { temperature: 0.1, maxTokens: 2048 },
  echo: { temperature: 0.7, maxTokens: 1024 },
  copilot: { temperature: 0.2, maxTokens: 4096 },
  'report-builder': { temperature: 0.1, maxTokens: 4096 },
  'pay-equity': { temperature: 0.1, maxTokens: 4096 },
  'attrition-predictor': { temperature: 0.2, maxTokens: 2048 },
  'calibration-assistant': { temperature: 0.1, maxTokens: 4096 },
  'budget-optimizer': { temperature: 0.1, maxTokens: 4096 },
};

/**
 * Load AI configuration from environment variables.
 * Supports both OpenAI and Azure OpenAI via AI_PROVIDER env var.
 *
 * For OpenAI: set OPENAI_API_KEY and optionally OPENAI_MODEL
 * For Azure:  set AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT,
 *             AZURE_OPENAI_DEPLOYMENT_NAME, AZURE_OPENAI_API_VERSION
 */
export function loadAIConfig(): AIConfig {
  const provider = (process.env['AI_PROVIDER'] ?? 'openai') as AIProvider;

  if (provider === 'azure') {
    const azureApiKey = process.env['AZURE_OPENAI_API_KEY'] ?? '';
    const endpoint = process.env['AZURE_OPENAI_ENDPOINT'] ?? '';
    const deploymentName = process.env['AZURE_OPENAI_DEPLOYMENT_NAME'] ?? 'gpt-4o';
    const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-08-01-preview';

    if (!azureApiKey || !endpoint) {
      throw new Error(
        'Azure OpenAI requires AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT. ' +
          'Set AI_PROVIDER=openai to use direct OpenAI instead.',
      );
    }

    return {
      provider: 'azure',
      apiKey: azureApiKey,
      azure: { endpoint, apiKey: azureApiKey, deploymentName, apiVersion },
      defaultModel: {
        model: deploymentName,
        temperature: 0.2,
        maxTokens: 2048,
      },
      graphModels: GRAPH_MODEL_DEFAULTS,
    };
  }

  // Anthropic (Claude)
  if (provider === 'anthropic') {
    const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is required when AI_PROVIDER=anthropic.',
      );
    }

    const model = process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-4-20250514';

    return {
      provider: 'anthropic',
      apiKey,
      defaultModel: {
        model,
        temperature: 0.2,
        maxTokens: 4096,
      },
      graphModels: GRAPH_MODEL_DEFAULTS,
    };
  }

  // Default: OpenAI
  const apiKey = process.env['OPENAI_API_KEY'] ?? '';
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required. Set it in your .env file.');
  }

  const model = process.env['OPENAI_MODEL'] ?? 'gpt-4o';

  return {
    provider: 'openai',
    apiKey,
    defaultModel: {
      model,
      temperature: 0.2,
      maxTokens: 2048,
    },
    graphModels: GRAPH_MODEL_DEFAULTS,
  };
}

/**
 * Resolve the model config for a specific graph type.
 * Merges default config with graph-specific overrides.
 * Supports tier-based model selection via AI_MODEL_REASONING, AI_MODEL_INTERACTIVE, AI_MODEL_BATCH env vars.
 */
export function resolveModelConfig(config: AIConfig, graphType?: string): ModelConfig {
  const base = config.defaultModel;
  if (!graphType) return base;

  // Check if there's a tier-specific model override
  const tier = GRAPH_TIER_MAP[graphType];
  let tierModel: string | undefined;

  if (tier) {
    const envKey = `AI_MODEL_${tier.toUpperCase()}`;
    tierModel = process.env[envKey] || undefined;
  }

  const overrides = config.graphModels[graphType];

  return {
    ...base,
    ...overrides,
    ...(tierModel ? { model: tierModel } : {}),
  };
}

/** Default timeout in milliseconds (60 seconds) */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Default number of retries on transient failures */
const DEFAULT_MAX_RETRIES = 6;

/**
 * Callback handler that logs token usage after each LLM call.
 * Helps track cost and detect runaway prompts.
 */
function createUsageLoggingCallbacks(graphType?: string) {
  return [
    {
      handleLLMEnd(output: {
        llmOutput?: {
          tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
        };
      }) {
        const usage = output?.llmOutput?.tokenUsage;
        if (usage) {
          console.log(
            `[ai:usage] graph=${graphType ?? 'unknown'} prompt=${usage.promptTokens ?? 0} completion=${usage.completionTokens ?? 0} total=${usage.totalTokens ?? 0}`,
          );
        }
      },
    },
  ];
}

/** Get the tier for a graph type */
export function getGraphTier(graphType: string): ModelTier {
  return GRAPH_TIER_MAP[graphType] ?? 'reasoning';
}

/**
 * Create a ChatOpenAI or AzureChatOpenAI instance based on the AI config.
 * This is the single point of model creation — all graphs should use this.
 *
 * Includes:
 * - 60 second timeout (configurable via AI_TIMEOUT_MS env var)
 * - 2 retries on transient failures (configurable via AI_MAX_RETRIES env var)
 * - Token usage logging via callbacks
 */
export async function createChatModel(
  aiConfig: AIConfig,
  modelConfig: ModelConfig,
  graphType?: string,
) {
  const timeout = parseInt(process.env['AI_TIMEOUT_MS'] ?? '', 10) || DEFAULT_TIMEOUT_MS;
  const maxRetries = parseInt(process.env['AI_MAX_RETRIES'] ?? '', 10) || DEFAULT_MAX_RETRIES;
  const callbacks = createUsageLoggingCallbacks(graphType);

  if (aiConfig.provider === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic({
      anthropicApiKey: aiConfig.apiKey,
      model: modelConfig.model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
      timeout,
      maxRetries,
      callbacks,
    });
  }

  if (aiConfig.provider === 'azure' && aiConfig.azure) {
    const { AzureChatOpenAI } = await import('@langchain/openai');
    return new AzureChatOpenAI({
      azureOpenAIApiKey: aiConfig.azure.apiKey,
      azureOpenAIApiDeploymentName: modelConfig.model || aiConfig.azure.deploymentName,
      azureOpenAIApiVersion: aiConfig.azure.apiVersion,
      azureOpenAIEndpoint: aiConfig.azure.endpoint,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
      timeout,
      maxRetries,
      callbacks,
    });
  }

  const { ChatOpenAI } = await import('@langchain/openai');
  return new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
    timeout,
    maxRetries,
    callbacks,
  });
}
