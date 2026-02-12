import { describe, it, expect } from 'vitest';
import { detectHiddenCharacters, replaceHiddenCharacters } from '../hidden-chars.js';

describe('detectHiddenCharacters', () => {
  it('detects NBSP', () => {
    const text = 'hello\u00A0world';
    const issues = detectHiddenCharacters(text, 1, 0);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.charType).toBe('NBSP');
    expect(issues[0]!.codePoint).toBe(0xa0);
    expect(issues[0]!.position).toBe(5);
    expect(issues[0]!.suggestedReplacement).toBe(' ');
  });

  it('detects zero-width space', () => {
    const text = 'hello\u200Bworld';
    const issues = detectHiddenCharacters(text, 1, 0);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.charType).toBe('ZERO_WIDTH_SPACE');
    expect(issues[0]!.codePoint).toBe(0x200b);
    expect(issues[0]!.suggestedReplacement).toBe('');
  });

  it('detects zero-width non-joiner', () => {
    const text = 'test\u200Cvalue';
    const issues = detectHiddenCharacters(text, 1, 0);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.charType).toBe('ZERO_WIDTH_NON_JOINER');
  });

  it('detects zero-width joiner', () => {
    const text = 'test\u200Dvalue';
    const issues = detectHiddenCharacters(text, 1, 0);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.charType).toBe('ZERO_WIDTH_JOINER');
  });

  it('detects smart double quotes', () => {
    const text = '\u201CHello\u201D';
    const issues = detectHiddenCharacters(text, 1, 0);
    expect(issues).toHaveLength(2);
    expect(issues[0]!.charType).toBe('LEFT_DOUBLE_QUOTE');
    expect(issues[1]!.charType).toBe('RIGHT_DOUBLE_QUOTE');
  });

  it('detects smart single quotes / curly apostrophes', () => {
    const text = '\u2018Hello\u2019';
    const issues = detectHiddenCharacters(text, 1, 0);
    expect(issues).toHaveLength(2);
    expect(issues[0]!.charType).toBe('LEFT_SINGLE_QUOTE');
    expect(issues[1]!.charType).toBe('RIGHT_SINGLE_QUOTE');
  });

  it('detects tab characters in unexpected places', () => {
    const text = 'hello\tworld';
    const issues = detectHiddenCharacters(text, 1, 0);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.charType).toBe('TAB');
    expect(issues[0]!.position).toBe(5);
  });

  it('does not flag tab at start of value', () => {
    const text = '\thello';
    const issues = detectHiddenCharacters(text, 1, 0);
    expect(issues).toHaveLength(0);
  });

  it('detects multiple hidden characters', () => {
    const text = '\u00A0hello\u200Bworld\u201C';
    const issues = detectHiddenCharacters(text, 1, 0);
    expect(issues).toHaveLength(3);
  });

  it('returns empty array for clean text', () => {
    const text = 'Hello World 123';
    const issues = detectHiddenCharacters(text, 1, 0);
    expect(issues).toHaveLength(0);
  });

  it('returns empty array for empty string', () => {
    const issues = detectHiddenCharacters('', 1, 0);
    expect(issues).toHaveLength(0);
  });

  it('includes correct row and column in results', () => {
    const text = 'hello\u00A0world';
    const issues = detectHiddenCharacters(text, 5, 3);
    expect(issues[0]!.row).toBe(5);
    expect(issues[0]!.column).toBe(3);
  });
});

describe('replaceHiddenCharacters', () => {
  it('replaces NBSP with regular space', () => {
    expect(replaceHiddenCharacters('hello\u00A0world')).toBe('hello world');
  });

  it('removes zero-width characters', () => {
    expect(replaceHiddenCharacters('hello\u200Bworld')).toBe('helloworld');
  });

  it('replaces smart quotes with straight quotes', () => {
    expect(replaceHiddenCharacters('\u201CHello\u201D')).toBe('"Hello"');
    expect(replaceHiddenCharacters('\u2018Hello\u2019')).toBe("'Hello'");
  });

  it('handles text with no hidden characters', () => {
    expect(replaceHiddenCharacters('Hello World')).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(replaceHiddenCharacters('')).toBe('');
  });
});

