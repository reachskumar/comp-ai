import { describe, it, expect } from 'vitest';
import { validateField, findDuplicates } from '../field-validators.js';
import { FieldType, IssueType, IssueSeverity } from '../types.js';

describe('validateField - EMPLOYEE_ID', () => {
  it('accepts valid employee IDs', () => {
    expect(validateField('EMP-001', FieldType.EMPLOYEE_ID).valid).toBe(true);
    expect(validateField('A', FieldType.EMPLOYEE_ID).valid).toBe(true);
    expect(validateField('123', FieldType.EMPLOYEE_ID).valid).toBe(true);
    expect(validateField('EMP001', FieldType.EMPLOYEE_ID).valid).toBe(true);
  });

  it('rejects invalid employee IDs', () => {
    const result = validateField('EMP 001', FieldType.EMPLOYEE_ID);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.issueType).toBe(IssueType.INVALID_FORMAT);
  });

  it('rejects empty when required', () => {
    const result = validateField('', FieldType.EMPLOYEE_ID);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.issueType).toBe(IssueType.MISSING_REQUIRED);
  });

  it('allows empty when not required', () => {
    const result = validateField('', FieldType.EMPLOYEE_ID, { required: false });
    expect(result.valid).toBe(true);
  });
});

describe('validateField - EMAIL', () => {
  it('accepts valid emails', () => {
    expect(validateField('user@example.com', FieldType.EMAIL).valid).toBe(true);
    expect(validateField('user.name@example.co.uk', FieldType.EMAIL).valid).toBe(true);
    expect(validateField('user+tag@example.com', FieldType.EMAIL).valid).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(validateField('not-an-email', FieldType.EMAIL).valid).toBe(false);
    expect(validateField('@no-local.com', FieldType.EMAIL).valid).toBe(false);
    expect(validateField('spaces in@email.com', FieldType.EMAIL).valid).toBe(false);
    expect(validateField('double@@at.com', FieldType.EMAIL).valid).toBe(false);
  });

  it('rejects empty when required', () => {
    const result = validateField('', FieldType.EMAIL);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.issueType).toBe(IssueType.MISSING_REQUIRED);
  });
});

describe('validateField - CURRENCY', () => {
  it('accepts valid ISO 4217 codes', () => {
    expect(validateField('USD', FieldType.CURRENCY).valid).toBe(true);
    expect(validateField('eur', FieldType.CURRENCY).valid).toBe(true);
    expect(validateField('GBP', FieldType.CURRENCY).valid).toBe(true);
    expect(validateField('JPY', FieldType.CURRENCY).valid).toBe(true);
  });

  it('rejects invalid currency codes', () => {
    expect(validateField('XYZ', FieldType.CURRENCY).valid).toBe(false);
    expect(validateField('USDX', FieldType.CURRENCY).valid).toBe(false);
    expect(validateField('US', FieldType.CURRENCY).valid).toBe(false);
  });

  it('accepts custom currency codes', () => {
    const result = validateField('BTC', FieldType.CURRENCY, { currencyCodes: ['BTC', 'ETH'] });
    expect(result.valid).toBe(true);
  });
});

describe('validateField - DATE', () => {
  it('accepts ISO 8601 dates', () => {
    expect(validateField('2024-01-15', FieldType.DATE).valid).toBe(true);
    expect(validateField('2024-12-31', FieldType.DATE).valid).toBe(true);
  });

  it('accepts DD-Mon-YY format', () => {
    expect(validateField('15-Jan-24', FieldType.DATE).valid).toBe(true);
    expect(validateField('01-Dec-2024', FieldType.DATE).valid).toBe(true);
  });

  it('accepts MM/DD/YYYY format', () => {
    expect(validateField('01/15/2024', FieldType.DATE).valid).toBe(true);
    expect(validateField('12/31/2024', FieldType.DATE).valid).toBe(true);
  });

  it('warns on ambiguous dates', () => {
    const result = validateField('01/02/2024', FieldType.DATE);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.severity).toBe(IssueSeverity.WARNING);
  });

  it('does not warn on unambiguous dates', () => {
    // 13 can only be a day, not a month
    const result = validateField('13/01/2024', FieldType.DATE);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('rejects invalid dates', () => {
    expect(validateField('not-a-date', FieldType.DATE).valid).toBe(false);
    expect(validateField('2024-13-01', FieldType.DATE).valid).toBe(false);
    expect(validateField('2024-02-30', FieldType.DATE).valid).toBe(false);
  });
});

describe('validateField - NUMBER', () => {
  it('accepts plain numbers', () => {
    expect(validateField('42', FieldType.NUMBER).valid).toBe(true);
    expect(validateField('3.14', FieldType.NUMBER).valid).toBe(true);
    expect(validateField('-10', FieldType.NUMBER).valid).toBe(true);
  });

  it('accepts US formatted numbers', () => {
    expect(validateField('1,000.50', FieldType.NUMBER).valid).toBe(true);
    expect(validateField('1,000,000', FieldType.NUMBER).valid).toBe(true);
  });

  it('accepts European formatted numbers with warning', () => {
    const result = validateField('1.000,50', FieldType.NUMBER);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('validates range constraints', () => {
    const result = validateField('150', FieldType.NUMBER, { min: 0, max: 100 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.issueType).toBe(IssueType.OUT_OF_RANGE);
  });

  it('rejects invalid numbers', () => {
    expect(validateField('abc', FieldType.NUMBER).valid).toBe(false);
    expect(validateField('12.34.56', FieldType.NUMBER).valid).toBe(false);
  });
});

describe('validateField - TEXT', () => {
  it('accepts any text by default', () => {
    expect(validateField('hello', FieldType.TEXT).valid).toBe(true);
    expect(validateField('', FieldType.TEXT).valid).toBe(true);
  });

  it('validates required text', () => {
    const result = validateField('', FieldType.TEXT, { required: true });
    expect(result.valid).toBe(false);
  });

  it('validates min/max length', () => {
    expect(validateField('hi', FieldType.TEXT, { minLength: 5 }).valid).toBe(false);
    expect(validateField('hello world', FieldType.TEXT, { maxLength: 5 }).valid).toBe(false);
  });

  it('validates pattern', () => {
    expect(validateField('abc', FieldType.TEXT, { pattern: /^\d+$/ }).valid).toBe(false);
    expect(validateField('123', FieldType.TEXT, { pattern: /^\d+$/ }).valid).toBe(true);
  });
});

describe('findDuplicates', () => {
  it('finds duplicate values', () => {
    const values = ['a', 'b', 'a', 'c', 'b'];
    const dupes = findDuplicates(values);
    expect(dupes.size).toBe(2);
    expect(dupes.get('a')).toEqual([0, 2]);
    expect(dupes.get('b')).toEqual([1, 4]);
  });

  it('returns empty map when no duplicates', () => {
    const values = ['a', 'b', 'c'];
    const dupes = findDuplicates(values);
    expect(dupes.size).toBe(0);
  });

  it('ignores empty values', () => {
    const values = ['a', '', '', 'b'];
    const dupes = findDuplicates(values);
    expect(dupes.size).toBe(0);
  });

  it('is case-insensitive', () => {
    const values = ['EMP-001', 'emp-001'];
    const dupes = findDuplicates(values);
    expect(dupes.size).toBe(1);
  });
});

