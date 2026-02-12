/**
 * AI configuration — model settings and environment-based API key.
 */

export interface ModelConfig {
  /** OpenAI model name (e.g. "gpt-4o") */
  model: string;
  /** Sampling temperature */
  temperature: number;
  /** Maximum tokens in response */
  maxTokens: number;
}

export interface AIConfig {
  /** OpenAI API key loaded from OPENAI_API_KEY env var */
  apiKey: string;
  /** Default model configuration */
  defaultModel: ModelConfig;
  /** Per-graph-type overrides */
  graphModels: Record<string, Partial<ModelConfig>>;
}

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
};

/**
 * Load AI configuration from environment variables.
 * Throws if OPENAI_API_KEY is not set.
 */
export function loadAIConfig(): AIConfig {
  const apiKey = process.env['OPENAI_API_KEY'] ?? '';
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY environment variable is required. Set it in your .env file.',
    );
  }

  const model = process.env['OPENAI_MODEL'] ?? 'gpt-4o';

  return {
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
 */
export function resolveModelConfig(
  config: AIConfig,
  graphType?: string,
): ModelConfig {
  const base = config.defaultModel;
  if (!graphType) return base;

  const overrides = config.graphModels[graphType];
  if (!overrides) return base;

  return {
    ...base,
    ...overrides,
  };
}

