/**
 * Hidden Character Detection
 * Detects NBSP, zero-width characters, smart quotes, curly apostrophes,
 * and unexpected tab characters in text content.
 */

import type { HiddenCharacterIssue } from './types.js';

// ─────────────────────────────────────────────────────────────
// Hidden Character Definitions
// ─────────────────────────────────────────────────────────────

interface HiddenCharDef {
  codePoint: number;
  charType: string;
  replacement: string;
}

const HIDDEN_CHARS: HiddenCharDef[] = [
  // Non-breaking space
  { codePoint: 0xa0, charType: 'NBSP', replacement: ' ' },

  // Zero-width characters
  { codePoint: 0x200b, charType: 'ZERO_WIDTH_SPACE', replacement: '' },
  { codePoint: 0x200c, charType: 'ZERO_WIDTH_NON_JOINER', replacement: '' },
  { codePoint: 0x200d, charType: 'ZERO_WIDTH_JOINER', replacement: '' },
  { codePoint: 0xfeff, charType: 'ZERO_WIDTH_NO_BREAK_SPACE', replacement: '' },

  // Smart quotes (double)
  { codePoint: 0x201c, charType: 'LEFT_DOUBLE_QUOTE', replacement: '"' },
  { codePoint: 0x201d, charType: 'RIGHT_DOUBLE_QUOTE', replacement: '"' },

  // Smart quotes (single) / curly apostrophes
  { codePoint: 0x2018, charType: 'LEFT_SINGLE_QUOTE', replacement: "'" },
  { codePoint: 0x2019, charType: 'RIGHT_SINGLE_QUOTE', replacement: "'" },

  // Other problematic characters
  { codePoint: 0x2013, charType: 'EN_DASH', replacement: '-' },
  { codePoint: 0x2014, charType: 'EM_DASH', replacement: '-' },
  { codePoint: 0x2026, charType: 'ELLIPSIS', replacement: '...' },
];

// Build a lookup map for fast detection
const HIDDEN_CHAR_MAP = new Map<number, HiddenCharDef>(
  HIDDEN_CHARS.map((def) => [def.codePoint, def]),
);

// ─────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────

/**
 * Detect hidden characters in a single text value.
 * Returns an array of issues with exact positions.
 *
 * @param text - The text to scan
 * @param row - Row number (for reporting)
 * @param column - Column number (for reporting)
 */
export function detectHiddenCharacters(
  text: string,
  row: number = 0,
  column: number = 0,
): HiddenCharacterIssue[] {
  const issues: HiddenCharacterIssue[] = [];

  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) continue;

    const def = HIDDEN_CHAR_MAP.get(codePoint);
    if (def) {
      issues.push({
        row,
        column,
        charType: def.charType,
        position: i,
        codePoint: def.codePoint,
        suggestedReplacement: def.replacement,
      });
    }

    // Check for tab characters in unexpected places (not at start of value)
    if (codePoint === 0x09 && i > 0) {
      issues.push({
        row,
        column,
        charType: 'TAB',
        position: i,
        codePoint: 0x09,
        suggestedReplacement: ' ',
      });
    }
  }

  return issues;
}

/**
 * Replace all hidden characters in a text value with their suggested replacements.
 */
export function replaceHiddenCharacters(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) {
      result += text[i];
      continue;
    }

    const def = HIDDEN_CHAR_MAP.get(codePoint);
    if (def) {
      result += def.replacement;
    } else if (codePoint === 0x09 && i > 0) {
      result += ' ';
    } else {
      // Handle surrogate pairs
      if (codePoint > 0xffff) {
        result += text.substring(i, i + 2);
        i++; // Skip the second code unit
      } else {
        result += text[i];
      }
    }
  }
  return result;
}

