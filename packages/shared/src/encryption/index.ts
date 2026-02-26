/**
 * AES-256-GCM encryption utilities for PII data at rest.
 *
 * Encrypted format: base64(iv):base64(authTag):base64(ciphertext)
 * - IV: 12 bytes (96-bit, recommended for GCM)
 * - Auth tag: 16 bytes (128-bit)
 * - Key: 32 bytes (256-bit), derived via PBKDF2
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
export function deriveKey(secret: string): Buffer {
  return pbkdf2Sync(secret, PBKDF2_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a string in the format: base64(iv):base64(tag):base64(ciphertext)
 *
 * Each call produces a unique ciphertext due to random IV generation.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a ciphertext string produced by `encrypt()`.
 * Throws if the key is wrong or the data has been tampered with.
 */
export function decrypt(ciphertext: string, key: Buffer): string {
  const [ivB64, tagB64, dataB64] = ciphertext.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted format: expected iv:tag:data');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

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
