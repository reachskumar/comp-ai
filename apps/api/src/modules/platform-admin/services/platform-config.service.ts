import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Platform configuration service.
 * Stores admin-managed settings in the database instead of environment variables.
 * Supports encrypted secrets (API keys, credentials).
 *
 * Categories:
 * - ai: AI model configuration, provider settings, token budgets
 * - market_data: Market data provider API keys and settings
 * - integrations: Compport bridge config, connector defaults
 * - security: Rate limiting, session, auth settings
 * - features: Feature flags per tenant or global
 */
@Injectable()
export class PlatformConfigService {
  private readonly logger = new Logger(PlatformConfigService.name);
  private readonly encryptionKey: Buffer;
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(private readonly db: DatabaseService) {
    const keyEnv =
      process.env['PLATFORM_CONFIG_ENCRYPTION_KEY'] ?? process.env['PII_ENCRYPTION_KEY'] ?? '';

    if (keyEnv.length >= 32) {
      this.encryptionKey = Buffer.from(keyEnv.slice(0, 32), 'utf-8');
      return;
    }

    // BLOCKER 3 (context.md): never fall back to a hardcoded dev key in
    // production. Anything encrypted with the committed key would be
    // readable by anyone with repo access. Hard fail so the missing config
    // is impossible to ignore.
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'PLATFORM_CONFIG_ENCRYPTION_KEY (or PII_ENCRYPTION_KEY) is not set or too short ' +
          '(need >=32 chars). Generate with `openssl rand -hex 32` and store in GCP ' +
          'Secret Manager. Refusing to start with a hardcoded dev key.',
      );
    }

    // Dev only — deterministic key so existing local fixtures still decrypt.
    this.encryptionKey = Buffer.from('platform-config-dev-key-32char!', 'utf-8');
    this.logger.warn(
      'Using deterministic dev encryption key. Set PLATFORM_CONFIG_ENCRYPTION_KEY in production.',
    );
  }

  // ─── Read ────────────────────────────────────────────────

  async get(category: string, key: string): Promise<string | null> {
    const cacheKey = `${category}:${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const config = await this.db.client.platformConfig.findUnique({
      where: { category_key: { category, key } },
    });

    if (!config) return null;

    const value = config.isSecret ? this.decrypt(config.value) : config.value;
    this.cache.set(cacheKey, { value, expiresAt: Date.now() + this.CACHE_TTL_MS });
    return value;
  }

  async getOrDefault(category: string, key: string, defaultValue: string): Promise<string> {
    const value = await this.get(category, key);
    return value && value.length > 0 ? value : defaultValue;
  }

  async getCategory(category: string): Promise<Array<{
    key: string;
    value: string;
    isSecret: boolean;
    description: string | null;
    updatedAt: Date;
    updatedBy: string | null;
  }>> {
    const configs = await this.db.client.platformConfig.findMany({
      where: { category },
      orderBy: { key: 'asc' },
    });

    return configs.map((c) => ({
      key: c.key,
      value: c.isSecret ? '••••••••' : c.value, // Never expose secrets
      isSecret: c.isSecret,
      description: c.description,
      updatedAt: c.updatedAt,
      updatedBy: c.updatedBy,
    }));
  }

  async getAllCategories(): Promise<string[]> {
    const results = await this.db.client.platformConfig.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return results.map((r) => r.category);
  }

  // ─── Write ───────────────────────────────────────────────

  async set(
    category: string,
    key: string,
    value: string,
    options?: { isSecret?: boolean; description?: string; updatedBy?: string },
  ): Promise<void> {
    const storedValue = options?.isSecret ? this.encrypt(value) : value;

    await this.db.client.platformConfig.upsert({
      where: { category_key: { category, key } },
      create: {
        category,
        key,
        value: storedValue,
        isSecret: options?.isSecret ?? false,
        description: options?.description,
        updatedBy: options?.updatedBy,
      },
      update: {
        value: storedValue,
        isSecret: options?.isSecret ?? undefined,
        description: options?.description ?? undefined,
        updatedBy: options?.updatedBy,
      },
    });

    // Invalidate cache
    this.cache.delete(`${category}:${key}`);

    this.logger.log(`Config updated: ${category}.${key} by ${options?.updatedBy ?? 'system'}`);
  }

  async delete(category: string, key: string): Promise<boolean> {
    try {
      await this.db.client.platformConfig.delete({
        where: { category_key: { category, key } },
      });
      this.cache.delete(`${category}:${key}`);
      return true;
    } catch {
      return false;
    }
  }

  async bulkSet(
    entries: Array<{ category: string; key: string; value: string; isSecret?: boolean; description?: string }>,
    updatedBy: string,
  ): Promise<number> {
    let count = 0;
    for (const entry of entries) {
      await this.set(entry.category, entry.key, entry.value, {
        isSecret: entry.isSecret,
        description: entry.description,
        updatedBy,
      });
      count++;
    }
    return count;
  }

  // ─── Validation ──────────────────────────────────────────

  async validateAIConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const provider = await this.get('ai', 'provider');

    if (provider === 'openai') {
      const apiKey = await this.get('ai', 'openai_api_key');
      if (!apiKey) errors.push('OpenAI API key not configured');
    } else if (provider === 'azure') {
      const apiKey = await this.get('ai', 'azure_api_key');
      const endpoint = await this.get('ai', 'azure_endpoint');
      if (!apiKey) errors.push('Azure OpenAI API key not configured');
      if (!endpoint) errors.push('Azure OpenAI endpoint not configured');
    }

    return { valid: errors.length === 0, errors };
  }

  async validateMarketDataConfig(providerType: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const apiKey = await this.get('market_data', `${providerType.toLowerCase()}_api_key`);
    if (!apiKey) errors.push(`API key not configured for ${providerType}`);
    return { valid: errors.length === 0, errors };
  }

  // ─── Encryption ──────────────────────────────────────────

  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  private decrypt(encoded: string): string {
    try {
      const packed = Buffer.from(encoded, 'base64');
      const iv = packed.subarray(0, IV_LENGTH);
      const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + 16);
      const ciphertext = packed.subarray(IV_LENGTH + 16);
      const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
    } catch {
      this.logger.warn('Failed to decrypt config value — may be stored in plain text');
      return encoded;
    }
  }
}
