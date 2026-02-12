/**
 * Field Validators
 * Validates field values based on their type (EMPLOYEE_ID, EMAIL, CURRENCY, DATE, NUMBER, TEXT).
 */

import {
  FieldType,
  IssueType,
  IssueSeverity,
  type ValidationResult,
  type ValidationError,
  type FieldValidationRules,
} from './types.js';

// ─────────────────────────────────────────────────────────────
// ISO 4217 Currency Codes (common subset)
// ─────────────────────────────────────────────────────────────

const ISO_4217_CODES = new Set([
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
  'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY',
  'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP',
  'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD',
  'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HRK', 'HTG', 'HUF', 'IDR', 'ILS',
  'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR',
  'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD',
  'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU',
  'MUR', 'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK',
  'NPR', 'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG',
  'QAR', 'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK',
  'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL',
  'THB', 'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH',
  'UGX', 'USD', 'UYU', 'UZS', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD',
  'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWL',
]);

// ─────────────────────────────────────────────────────────────
// Regex Patterns
// ─────────────────────────────────────────────────────────────

// Simplified RFC 5322 email regex
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Employee ID: alphanumeric with optional hyphens
const EMPLOYEE_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;

// ─────────────────────────────────────────────────────────────
// Date Parsing
// ─────────────────────────────────────────────────────────────

interface DateParseResult {
  valid: boolean;
  ambiguous: boolean;
  date?: Date;
  format?: string;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(value: string): DateParseResult {
  const trimmed = value.trim();

  // YYYY-MM-DD (ISO 8601)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (isValidDate(date, Number(y), Number(m) - 1, Number(d))) {
      return { valid: true, ambiguous: false, date, format: 'YYYY-MM-DD' };
    }
    return { valid: false, ambiguous: false };
  }

  // DD-Mon-YY or DD-Mon-YYYY
  const monMatch = trimmed.match(/^(\d{1,2})[-/\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[-/\s](\d{2,4})$/i);
  if (monMatch) {
    const [, d, mon, y] = monMatch;
    const month = MONTH_NAMES[mon!.toLowerCase()];
    let year = Number(y);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (month !== undefined) {
      const date = new Date(year, month, Number(d));
      if (isValidDate(date, year, month, Number(d))) {
        return { valid: true, ambiguous: false, date, format: 'DD-Mon-YY' };
      }
    }
    return { valid: false, ambiguous: false };
  }

  // MM/DD/YYYY or DD/MM/YYYY (ambiguous when both parts <= 12)
  const slashMatch = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slashMatch) {
    const [, a, b, y] = slashMatch;
    let year = Number(y);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    const numA = Number(a);
    const numB = Number(b);

    const ambiguous = numA <= 12 && numB <= 12 && numA !== numB;

    // Try MM/DD/YYYY first (US format)
    const dateMMDD = new Date(year, numA - 1, numB);
    if (isValidDate(dateMMDD, year, numA - 1, numB)) {
      return { valid: true, ambiguous, date: dateMMDD, format: 'MM/DD/YYYY' };
    }

    // Try DD/MM/YYYY
    const dateDDMM = new Date(year, numB - 1, numA);
    if (isValidDate(dateDDMM, year, numB - 1, numA)) {
      return { valid: true, ambiguous, date: dateDDMM, format: 'DD/MM/YYYY' };
    }

    return { valid: false, ambiguous: false };
  }

  return { valid: false, ambiguous: false };
}

function isValidDate(date: Date, year: number, month: number, day: number): boolean {
  return (
    date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
  );
}



// ─────────────────────────────────────────────────────────────
// Number Parsing
// ─────────────────────────────────────────────────────────────

interface NumberParseResult {
  valid: boolean;
  value?: number;
  localeWarning?: string;
}

function parseNumber(value: string): NumberParseResult {
  const trimmed = value.trim();
  if (trimmed === '') return { valid: false };

  // Detect locale-specific formatting
  // European: 1.000,50 (dots as thousands, comma as decimal)
  // US: 1,000.50 (commas as thousands, dot as decimal)
  const hasCommaDecimal = /^\d{1,3}(\.\d{3})*,\d+$/.test(trimmed);
  const hasDotDecimal = /^\d{1,3}(,\d{3})*\.\d+$/.test(trimmed);
  const isPlainNumber = /^-?\d+(\.\d+)?$/.test(trimmed);

  if (hasCommaDecimal) {
    // European format: 1.000,50
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const num = Number(normalized);
    if (!isNaN(num)) {
      return { valid: true, value: num, localeWarning: 'European number format detected (comma as decimal separator)' };
    }
  }

  if (hasDotDecimal) {
    // US format: 1,000.50
    const normalized = trimmed.replace(/,/g, '');
    const num = Number(normalized);
    if (!isNaN(num)) {
      return { valid: true, value: num };
    }
  }

  if (isPlainNumber) {
    const num = Number(trimmed);
    if (!isNaN(num)) {
      return { valid: true, value: num };
    }
  }

  // Try plain parse as fallback
  const num = Number(trimmed.replace(/,/g, ''));
  if (!isNaN(num)) {
    return { valid: true, value: num };
  }

  return { valid: false };
}

// ─────────────────────────────────────────────────────────────
// Individual Validators
// ─────────────────────────────────────────────────────────────

function validateEmployeeId(value: string, rules: FieldValidationRules): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!value || value.trim() === '') {
    if (rules.required !== false) {
      errors.push({
        field: 'EMPLOYEE_ID',
        message: 'Employee ID is required',
        issueType: IssueType.MISSING_REQUIRED,
        severity: IssueSeverity.ERROR,
      });
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  if (!EMPLOYEE_ID_REGEX.test(value.trim())) {
    errors.push({
      field: 'EMPLOYEE_ID',
      message: 'Employee ID must be alphanumeric (hyphens allowed)',
      issueType: IssueType.INVALID_FORMAT,
      severity: IssueSeverity.ERROR,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateEmail(value: string, rules: FieldValidationRules): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!value || value.trim() === '') {
    if (rules.required !== false) {
      errors.push({
        field: 'EMAIL',
        message: 'Email is required',
        issueType: IssueType.MISSING_REQUIRED,
        severity: IssueSeverity.ERROR,
      });
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  if (!EMAIL_REGEX.test(value.trim())) {
    errors.push({
      field: 'EMAIL',
      message: `Invalid email format: ${value}`,
      issueType: IssueType.INVALID_FORMAT,
      severity: IssueSeverity.ERROR,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateCurrency(value: string, rules: FieldValidationRules): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!value || value.trim() === '') {
    if (rules.required !== false) {
      errors.push({
        field: 'CURRENCY',
        message: 'Currency code is required',
        issueType: IssueType.MISSING_REQUIRED,
        severity: IssueSeverity.ERROR,
      });
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  const codes = rules.currencyCodes ? new Set(rules.currencyCodes) : ISO_4217_CODES;
  if (!codes.has(value.trim().toUpperCase())) {
    errors.push({
      field: 'CURRENCY',
      message: `Invalid ISO 4217 currency code: ${value}`,
      issueType: IssueType.INVALID_FORMAT,
      severity: IssueSeverity.ERROR,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateDate(value: string, rules: FieldValidationRules): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!value || value.trim() === '') {
    if (rules.required !== false) {
      errors.push({
        field: 'DATE',
        message: 'Date is required',
        issueType: IssueType.MISSING_REQUIRED,
        severity: IssueSeverity.ERROR,
      });
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  const result = parseDate(value);
  if (!result.valid) {
    errors.push({
      field: 'DATE',
      message: `Invalid date format: ${value}`,
      issueType: IssueType.INVALID_FORMAT,
      severity: IssueSeverity.ERROR,
    });
  } else if (result.ambiguous) {
    warnings.push({
      field: 'DATE',
      message: `Ambiguous date format (could be MM/DD or DD/MM): ${value}`,
      issueType: IssueType.INVALID_FORMAT,
      severity: IssueSeverity.WARNING,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateNumber(value: string, rules: FieldValidationRules): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!value || value.trim() === '') {
    if (rules.required !== false) {
      errors.push({
        field: 'NUMBER',
        message: 'Number is required',
        issueType: IssueType.MISSING_REQUIRED,
        severity: IssueSeverity.ERROR,
      });
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  const result = parseNumber(value);
  if (!result.valid) {
    errors.push({
      field: 'NUMBER',
      message: `Invalid number format: ${value}`,
      issueType: IssueType.INVALID_FORMAT,
      severity: IssueSeverity.ERROR,
    });
    return { valid: false, errors, warnings };
  }

  if (result.localeWarning) {
    warnings.push({
      field: 'NUMBER',
      message: result.localeWarning,
      issueType: IssueType.INVALID_FORMAT,
      severity: IssueSeverity.WARNING,
    });
  }

  if (rules.min !== undefined && result.value !== undefined && result.value < rules.min) {
    errors.push({
      field: 'NUMBER',
      message: `Value ${result.value} is below minimum ${rules.min}`,
      issueType: IssueType.OUT_OF_RANGE,
      severity: IssueSeverity.ERROR,
    });
  }

  if (rules.max !== undefined && result.value !== undefined && result.value > rules.max) {
    errors.push({
      field: 'NUMBER',
      message: `Value ${result.value} exceeds maximum ${rules.max}`,
      issueType: IssueType.OUT_OF_RANGE,
      severity: IssueSeverity.ERROR,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateText(value: string, rules: FieldValidationRules): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!value || value.trim() === '') {
    if (rules.required) {
      errors.push({
        field: 'TEXT',
        message: 'Text field is required',
        issueType: IssueType.MISSING_REQUIRED,
        severity: IssueSeverity.ERROR,
      });
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  if (rules.minLength !== undefined && value.length < rules.minLength) {
    errors.push({
      field: 'TEXT',
      message: `Text length ${value.length} is below minimum ${rules.minLength}`,
      issueType: IssueType.INVALID_FORMAT,
      severity: IssueSeverity.ERROR,
    });
  }

  if (rules.maxLength !== undefined && value.length > rules.maxLength) {
    errors.push({
      field: 'TEXT',
      message: `Text length ${value.length} exceeds maximum ${rules.maxLength}`,
      issueType: IssueType.INVALID_FORMAT,
      severity: IssueSeverity.ERROR,
    });
  }

  if (rules.pattern && !rules.pattern.test(value)) {
    errors.push({
      field: 'TEXT',
      message: `Text does not match required pattern`,
      issueType: IssueType.INVALID_FORMAT,
      severity: IssueSeverity.ERROR,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────────────────────────────
// Main Validator
// ─────────────────────────────────────────────────────────────

/**
 * Validate a field value based on its type and optional rules.
 */
export function validateField(
  value: string,
  fieldType: FieldType,
  rules: FieldValidationRules = {},
): ValidationResult {
  switch (fieldType) {
    case FieldType.EMPLOYEE_ID:
      return validateEmployeeId(value, rules);
    case FieldType.EMAIL:
      return validateEmail(value, rules);
    case FieldType.CURRENCY:
      return validateCurrency(value, rules);
    case FieldType.DATE:
      return validateDate(value, rules);
    case FieldType.NUMBER:
      return validateNumber(value, rules);
    case FieldType.TEXT:
      return validateText(value, rules);
    default:
      return { valid: true, errors: [], warnings: [] };
  }
}

/**
 * Check for duplicate values in a column.
 * Returns indices of duplicate rows.
 */
export function findDuplicates(values: string[]): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  for (let i = 0; i < values.length; i++) {
    const val = values[i]!.trim().toLowerCase();
    if (val === '') continue;
    const existing = seen.get(val);
    if (existing) {
      existing.push(i);
    } else {
      seen.set(val, [i]);
    }
  }

  // Filter to only duplicates
  const duplicates = new Map<string, number[]>();
  for (const [key, indices] of seen) {
    if (indices.length > 1) {
      duplicates.set(key, indices);
    }
  }
  return duplicates;
}