import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * AES-256-GCM encryption service for PHI data (SSN, etc.).
 * Encrypted format: base64(iv + authTag + ciphertext)
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('BENEFITS_ENCRYPTION_KEY');
    if (secret && secret.length >= 32) {
      this.key = Buffer.from(secret.slice(0, 32), 'utf-8');
    } else {
      // Fallback for development — NOT for production
      this.key = Buffer.from('benefits-dev-key-32-chars-long!!', 'utf-8');
      this.logger.warn(
        'Using default encryption key. Set BENEFITS_ENCRYPTION_KEY in production.',
      );
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    // Pack: iv (16) + authTag (16) + ciphertext
    const packed = Buffer.concat([iv, authTag, encrypted]);
    return packed.toString('base64');
  }

  decrypt(encoded: string): string {
    const packed = Buffer.from(encoded, 'base64');
    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString('utf-8');
  }

  /**
   * Mask SSN for API responses — returns ***-**-XXXX (last 4 only).
   * HIPAA: Never return full SSN in API responses.
   */
  maskSsn(encryptedSsn: string | null): string | null {
    if (!encryptedSsn) return null;
    try {
      const ssn = this.decrypt(encryptedSsn);
      const last4 = ssn.replace(/\D/g, '').slice(-4);
      return `***-**-${last4}`;
    } catch {
      return '***-**-****';
    }
  }
}

