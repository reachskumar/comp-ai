import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, deriveKey } from './index.js';
import { randomBytes } from 'crypto';

describe('encryption', () => {
  const secret = 'test-secret-key-for-unit-tests';
  const key = deriveKey(secret);

  describe('deriveKey', () => {
    it('returns a 32-byte buffer', () => {
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('produces the same key for the same secret', () => {
      const key2 = deriveKey(secret);
      expect(key.equals(key2)).toBe(true);
    });

    it('produces different keys for different secrets', () => {
      const key2 = deriveKey('different-secret');
      expect(key.equals(key2)).toBe(false);
    });
  });

  describe('encrypt / decrypt roundtrip', () => {
    it('encrypts and decrypts a simple string', () => {
      const plaintext = '123-45-6789';
      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypts and decrypts an empty string', () => {
      const encrypted = encrypt('', key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe('');
    });

    it('encrypts and decrypts unicode text', () => {
      const plaintext = 'José García — SSN: 123-45-6789 🔒';
      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('encrypted text differs from plaintext', () => {
      const plaintext = '123-45-6789';
      const encrypted = encrypt(plaintext, key);
      expect(encrypted).not.toBe(plaintext);
      // Encrypted format is iv:tag:data (3 base64 parts)
      expect(encrypted.split(':')).toHaveLength(3);
    });

    it('produces different ciphertexts for the same plaintext (random IV)', () => {
      const plaintext = '123-45-6789';
      const encrypted1 = encrypt(plaintext, key);
      const encrypted2 = encrypt(plaintext, key);
      expect(encrypted1).not.toBe(encrypted2);
      // Both should still decrypt to the same value
      expect(decrypt(encrypted1, key)).toBe(plaintext);
      expect(decrypt(encrypted2, key)).toBe(plaintext);
    });
  });

  describe('decrypt with wrong key', () => {
    it('throws when decrypting with a different key', () => {
      const plaintext = '123-45-6789';
      const encrypted = encrypt(plaintext, key);
      const wrongKey = deriveKey('wrong-secret');
      expect(() => decrypt(encrypted, wrongKey)).toThrow();
    });

    it('throws when decrypting with a random 32-byte key', () => {
      const plaintext = 'sensitive-data';
      const encrypted = encrypt(plaintext, key);
      const randomKey = randomBytes(32);
      expect(() => decrypt(encrypted, randomKey)).toThrow();
    });
  });

  describe('invalid input handling', () => {
    it('throws on malformed encrypted string (missing parts)', () => {
      expect(() => decrypt('not-valid', key)).toThrow('Invalid encrypted format');
    });

    it('throws on tampered ciphertext', () => {
      const encrypted = encrypt('test', key);
      const parts = encrypted.split(':');
      // Tamper with the data portion
      parts[2] = Buffer.from('tampered').toString('base64');
      expect(() => decrypt(parts.join(':'), key)).toThrow();
    });
  });
});
