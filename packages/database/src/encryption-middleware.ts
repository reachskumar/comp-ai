/**
 * PII Encryption Middleware for Prisma
 *
 * Provides transparent AES-256-GCM encryption/decryption for sensitive fields.
 * Currently targets BenefitDependent.ssnEncrypted.
 *
 * Only active when PII_ENCRYPTION_KEY environment variable is set.
 * Uses Prisma client extensions (Prisma 7+).
 */
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha256';
const PBKDF2_SALT = 'compport-pii-salt';

/**
 * Derive a 256-bit encryption key from a secret string using PBKDF2.
 */
export function piiDeriveKey(secret: string): Buffer {
  return pbkdf2Sync(secret, PBKDF2_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns: base64(iv):base64(tag):base64(ciphertext)
 */
export function piiEncrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a ciphertext string produced by `piiEncrypt()`.
 */
export function piiDecrypt(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format: expected iv:tag:data');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64!, 'base64');
  const tag = Buffer.from(tagB64!, 'base64');
  const data = Buffer.from(dataB64!, 'base64');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${TAG_LENGTH}, got ${tag.length}`);
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

/** Fields to encrypt per model. Maps model name → field names. */
const ENCRYPTED_FIELDS: Record<string, string[]> = {
  BenefitDependent: ['ssnEncrypted'],
};

/**
 * Create a Prisma client extension that transparently encrypts/decrypts
 * PII fields on write and read operations.
 *
 * @param encryptionKey - The derived 32-byte encryption key
 */
export function createPiiEncryptionExtension(encryptionKey: Buffer) {
  return {
    name: 'pii-encryption',
    query: {
      benefitDependent: {
        async create({
          args,
          query,
        }: {
          args: { data: Record<string, unknown> };
          query: (args: unknown) => Promise<unknown>;
        }) {
          encryptFields(args.data, 'BenefitDependent', encryptionKey);
          const result = (await query(args)) as Record<string, unknown>;
          decryptFields(result, 'BenefitDependent', encryptionKey);
          return result;
        },
        async update({
          args,
          query,
        }: {
          args: { data: Record<string, unknown> };
          query: (args: unknown) => Promise<unknown>;
        }) {
          encryptFields(args.data, 'BenefitDependent', encryptionKey);
          const result = (await query(args)) as Record<string, unknown>;
          decryptFields(result, 'BenefitDependent', encryptionKey);
          return result;
        },
        async findFirst({
          args,
          query,
        }: {
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const result = (await query(args)) as Record<string, unknown> | null;
          if (result) decryptFields(result, 'BenefitDependent', encryptionKey);
          return result;
        },
        async findMany({
          args,
          query,
        }: {
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const results = (await query(args)) as Record<string, unknown>[];
          for (const result of results) {
            decryptFields(result, 'BenefitDependent', encryptionKey);
          }
          return results;
        },
        async findUnique({
          args,
          query,
        }: {
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const result = (await query(args)) as Record<string, unknown> | null;
          if (result) decryptFields(result, 'BenefitDependent', encryptionKey);
          return result;
        },
      },
    },
  };
}

function encryptFields(data: Record<string, unknown>, model: string, key: Buffer): void {
  const fields = ENCRYPTED_FIELDS[model];
  if (!fields) return;
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string' && value.length > 0) {
      data[field] = piiEncrypt(value, key);
    }
  }
}

function decryptFields(data: Record<string, unknown>, model: string, key: Buffer): void {
  const fields = ENCRYPTED_FIELDS[model];
  if (!fields) return;
  for (const field of fields) {
    const value = data[field];
    if (typeof value === 'string' && value.length > 0) {
      try {
        data[field] = piiDecrypt(value, key);
      } catch {
        // If decryption fails (e.g., data was stored before encryption was enabled),
        // leave the value as-is rather than crashing.
      }
    }
  }
}
