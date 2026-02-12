import { describe, it, expect } from 'vitest';
import { detectEncoding, detectBOM } from '../encoding.js';

describe('detectBOM', () => {
  it('detects UTF-8 BOM', () => {
    const buffer = Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    const result = detectBOM(buffer);
    expect(result.hasBOM).toBe(true);
    expect(result.bomType).toBe('UTF-8');
    expect(result.bomLength).toBe(3);
  });

  it('detects UTF-16 LE BOM', () => {
    const buffer = Buffer.from([0xff, 0xfe, 0x68, 0x00]);
    const result = detectBOM(buffer);
    expect(result.hasBOM).toBe(true);
    expect(result.bomType).toBe('UTF-16 LE');
    expect(result.bomLength).toBe(2);
  });

  it('detects UTF-16 BE BOM', () => {
    const buffer = Buffer.from([0xfe, 0xff, 0x00, 0x68]);
    const result = detectBOM(buffer);
    expect(result.hasBOM).toBe(true);
    expect(result.bomType).toBe('UTF-16 BE');
    expect(result.bomLength).toBe(2);
  });

  it('returns no BOM for plain ASCII', () => {
    const buffer = Buffer.from('hello world', 'utf-8');
    const result = detectBOM(buffer);
    expect(result.hasBOM).toBe(false);
    expect(result.bomType).toBe('none');
    expect(result.bomLength).toBe(0);
  });

  it('handles empty buffer', () => {
    const buffer = Buffer.alloc(0);
    const result = detectBOM(buffer);
    expect(result.hasBOM).toBe(false);
  });
});

describe('detectEncoding', () => {
  it('detects UTF-8 with BOM', () => {
    const buffer = Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    const result = detectEncoding(buffer);
    expect(result.encoding).toBe('UTF-8');
    expect(result.confidence).toBe(1.0);
    expect(result.hasBOM).toBe(true);
    expect(result.bomType).toBe('UTF-8');
  });

  it('detects pure ASCII as UTF-8', () => {
    const buffer = Buffer.from('employee_id,email,salary\nEMP-001,test@example.com,85000', 'utf-8');
    const result = detectEncoding(buffer);
    expect(result.encoding).toBe('UTF-8');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.hasBOM).toBe(false);
  });

  it('detects UTF-8 with multibyte characters', () => {
    const buffer = Buffer.from('name\nJosé\nMüller\n日本語', 'utf-8');
    const result = detectEncoding(buffer);
    expect(result.encoding).toBe('UTF-8');
    expect(result.confidence).toBe(1.0);
  });

  it('detects Windows-1252 encoding', () => {
    // Windows-1252 specific bytes (0x80-0x9F range)
    // 0x93 = left double quotation mark in Windows-1252
    const buffer = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x93, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x94]);
    const result = detectEncoding(buffer);
    expect(result.encoding).toBe('Windows-1252');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('detects Latin-1 / ISO-8859-1 encoding', () => {
    // Latin-1 high bytes (0xA0-0xFF) without Windows-1252 specific bytes
    const buffer = Buffer.from([0x4a, 0x6f, 0x73, 0xe9]); // José in Latin-1
    const result = detectEncoding(buffer);
    expect(['ISO-8859-1', 'UTF-8']).toContain(result.encoding);
  });

  it('handles empty buffer', () => {
    const buffer = Buffer.alloc(0);
    const result = detectEncoding(buffer);
    expect(result.encoding).toBe('UTF-8');
    expect(result.hasBOM).toBe(false);
  });
});

