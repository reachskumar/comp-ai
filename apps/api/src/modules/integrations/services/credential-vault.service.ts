import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 16;

/**
 * Credential Vault Service
 * Encrypts/decrypts connector credentials using AES-256-GCM.
 * Per-tenant key derivation from a master key ensures tenant isolation.
 */
@Injectable()
export class CredentialVaultService {
  private readonly logger = new Logger(CredentialVaultService.name);
  private readonly masterKey: string;

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.get<string>('INTEGRATION_ENCRYPTION_KEY');
    if (!key || key.length < 32) {
      this.logger.warn(
        'INTEGRATION_ENCRYPTION_KEY not set or too short. Credential encryption will fail.',
      );
    }
    this.masterKey = key ?? '';
  }

  /**
   * Derive a per-tenant encryption key from the master key.
   * Uses PBKDF2 with tenant-specific salt for isolation.
   */
  private deriveTenantKey(tenantId: string): Buffer {
    return crypto.pbkdf2Sync(
      this.masterKey,
      `tenant:${tenantId}`,
      100000,
      KEY_LENGTH,
      'sha512',
    );
  }

  /**
   * Encrypt credentials for storage.
   * Returns { encrypted, iv, tag } all as hex strings.
   */
  encrypt(
    tenantId: string,
    credentials: Record<string, unknown>,
  ): { encrypted: string; iv: string; tag: string } {
    const key = this.deriveTenantKey(tenantId);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const plaintext = JSON.stringify(credentials);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      encrypted: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
    };
  }

  /**
   * Decrypt credentials from storage.
   * Never logs or exposes the decrypted values.
   */
  decrypt(
    tenantId: string,
    encrypted: string,
    iv: string,
    tag: string,
  ): Record<string, unknown> {
    const key = this.deriveTenantKey(tenantId);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'hex')),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8')) as Record<string, unknown>;
  }

  /**
   * Mask credentials for API responses.
   * Replaces all values with '***' to prevent leakage.
   */
  maskCredentials(credentials: Record<string, unknown>): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const key of Object.keys(credentials)) {
      masked[key] = '***';
    }
    return masked;
  }
}

