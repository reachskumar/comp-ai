/**
 * Encoding Detection
 * Detects BOM markers and encoding from content analysis.
 */

import type { BOMType, EncodingResult } from './types.js';

// ─────────────────────────────────────────────────────────────
// BOM Detection
// ─────────────────────────────────────────────────────────────

interface BOMDetectionResult {
  hasBOM: boolean;
  bomType: BOMType;
  bomLength: number;
}

/**
 * Detect Byte Order Mark (BOM) at the start of a buffer.
 */
export function detectBOM(buffer: Buffer): BOMDetectionResult {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { hasBOM: true, bomType: 'UTF-8', bomLength: 3 };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { hasBOM: true, bomType: 'UTF-16 LE', bomLength: 2 };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { hasBOM: true, bomType: 'UTF-16 BE', bomLength: 2 };
  }
  return { hasBOM: false, bomType: 'none', bomLength: 0 };
}

// ─────────────────────────────────────────────────────────────
// Encoding Detection from Content Analysis
// ─────────────────────────────────────────────────────────────

/**
 * Check if a buffer is valid UTF-8.
 * Returns a confidence score between 0 and 1.
 */
function analyzeUTF8(buffer: Buffer): number {
  let validMultibyte = 0;
  let invalidSequences = 0;
  let i = 0;

  while (i < buffer.length) {
    const byte = buffer[i]!;

    if (byte <= 0x7f) {
      // ASCII - valid in all encodings
      i++;
      continue;
    }

    // Check for valid UTF-8 multi-byte sequences
    if (byte >= 0xc2 && byte <= 0xdf) {
      // 2-byte sequence
      if (i + 1 < buffer.length && (buffer[i + 1]! & 0xc0) === 0x80) {
        validMultibyte++;
        i += 2;
        continue;
      }
    } else if (byte >= 0xe0 && byte <= 0xef) {
      // 3-byte sequence
      if (
        i + 2 < buffer.length &&
        (buffer[i + 1]! & 0xc0) === 0x80 &&
        (buffer[i + 2]! & 0xc0) === 0x80
      ) {
        validMultibyte++;
        i += 3;
        continue;
      }
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      // 4-byte sequence
      if (
        i + 3 < buffer.length &&
        (buffer[i + 1]! & 0xc0) === 0x80 &&
        (buffer[i + 2]! & 0xc0) === 0x80 &&
        (buffer[i + 3]! & 0xc0) === 0x80
      ) {
        validMultibyte++;
        i += 4;
        continue;
      }
    }

    // Invalid UTF-8 sequence
    invalidSequences++;
    i++;
  }

  if (invalidSequences === 0 && validMultibyte > 0) {
    return 1.0;
  }
  if (invalidSequences === 0) {
    // Pure ASCII - could be any encoding
    return 0.8;
  }
  if (validMultibyte > invalidSequences * 2) {
    return 0.5;
  }
  return 0.1;
}

/**
 * Check for Windows-1252 / Latin-1 specific byte patterns.
 * Returns a confidence score between 0 and 1.
 */
function analyzeWindows1252(buffer: Buffer): number {
  let windows1252Chars = 0;
  let highByteCount = 0;

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i]!;
    if (byte > 0x7f) {
      highByteCount++;
      // Windows-1252 specific range (0x80-0x9F) that differs from Latin-1
      if (byte >= 0x80 && byte <= 0x9f) {
        windows1252Chars++;
      }
    }
  }

  if (highByteCount === 0) return 0.5; // Pure ASCII
  if (windows1252Chars > 0) return 0.9;
  if (highByteCount > 0) return 0.7; // Could be Latin-1
  return 0.3;
}

/**
 * Detect the encoding of a buffer.
 * Returns encoding name, confidence score, and BOM information.
 */
export function detectEncoding(buffer: Buffer): EncodingResult {
  const bom = detectBOM(buffer);

  if (bom.hasBOM) {
    return {
      encoding: bom.bomType === 'none' ? 'UTF-8' : bom.bomType.replace(' LE', '-LE').replace(' BE', '-BE'),
      confidence: 1.0,
      hasBOM: true,
      bomType: bom.bomType,
    };
  }

  // Analyze content without BOM
  const utf8Confidence = analyzeUTF8(buffer);
  const win1252Confidence = analyzeWindows1252(buffer);

  if (utf8Confidence >= 0.9) {
    return { encoding: 'UTF-8', confidence: utf8Confidence, hasBOM: false, bomType: 'none' };
  }

  if (win1252Confidence > utf8Confidence) {
    // Distinguish between Windows-1252 and Latin-1
    const hasWin1252SpecificChars = Array.from(buffer).some(
      (b) => b >= 0x80 && b <= 0x9f,
    );
    return {
      encoding: hasWin1252SpecificChars ? 'Windows-1252' : 'ISO-8859-1',
      confidence: win1252Confidence,
      hasBOM: false,
      bomType: 'none',
    };
  }

  return { encoding: 'UTF-8', confidence: utf8Confidence, hasBOM: false, bomType: 'none' };
}

