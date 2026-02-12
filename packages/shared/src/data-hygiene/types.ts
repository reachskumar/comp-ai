/**
 * Data Hygiene Types
 * Shared types for file analysis, encoding detection, hidden character detection,
 * and field validation in the compensation platform.
 */

// ─────────────────────────────────────────────────────────────
// Enums (mirroring Prisma schema definitions)
// ─────────────────────────────────────────────────────────────

export enum IssueType {
  BOM = 'BOM',
  NBSP = 'NBSP',
  ZERO_WIDTH = 'ZERO_WIDTH',
  SMART_QUOTE = 'SMART_QUOTE',
  ENCODING = 'ENCODING',
  INVALID_FORMAT = 'INVALID_FORMAT',
  DUPLICATE = 'DUPLICATE',
  MISSING_REQUIRED = 'MISSING_REQUIRED',
  OUT_OF_RANGE = 'OUT_OF_RANGE',
  CUSTOM = 'CUSTOM',
}

export enum IssueSeverity {
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

export enum FieldType {
  EMPLOYEE_ID = 'EMPLOYEE_ID',
  EMAIL = 'EMAIL',
  CURRENCY = 'CURRENCY',
  DATE = 'DATE',
  NUMBER = 'NUMBER',
  TEXT = 'TEXT',
}

// ─────────────────────────────────────────────────────────────
// Encoding
// ─────────────────────────────────────────────────────────────

export type BOMType = 'UTF-8' | 'UTF-16 LE' | 'UTF-16 BE' | 'none';

export interface EncodingResult {
  encoding: string;
  confidence: number;
  hasBOM: boolean;
  bomType: BOMType;
}

// ─────────────────────────────────────────────────────────────
// Hidden Characters
// ─────────────────────────────────────────────────────────────

export interface HiddenCharacterIssue {
  row: number;
  column: number;
  charType: string;
  position: number;
  codePoint: number;
  suggestedReplacement: string;
}

// ─────────────────────────────────────────────────────────────
// Field Validation
// ─────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
  issueType: IssueType;
  severity: IssueSeverity;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface FieldValidationRules {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  dateFormat?: string;
  currencyCodes?: string[];
}

// ─────────────────────────────────────────────────────────────
// Issues
// ─────────────────────────────────────────────────────────────

export interface Issue {
  row: number;
  column: number;
  type: IssueType;
  severity: IssueSeverity;
  originalValue: string;
  suggestedFix: string;
  description: string;
}

// ─────────────────────────────────────────────────────────────
// Field Report
// ─────────────────────────────────────────────────────────────

export interface FieldReport {
  columnIndex: number;
  columnName: string;
  fieldType: FieldType | null;
  totalValues: number;
  emptyValues: number;
  invalidValues: number;
  issues: Issue[];
}

// ─────────────────────────────────────────────────────────────
// Analysis Report
// ─────────────────────────────────────────────────────────────

export interface FileInfo {
  size: number;
  totalRows: number;
  totalColumns: number;
  headers: string[];
}

export interface AnalysisSummary {
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface AnalysisReport {
  fileInfo: FileInfo;
  encoding: EncodingResult;
  issues: Issue[];
  summary: AnalysisSummary;
  fieldReports: FieldReport[];
}

// ─────────────────────────────────────────────────────────────
// Analyzer Options
// ─────────────────────────────────────────────────────────────

export interface ColumnMapping {
  [columnName: string]: FieldType;
}

export interface AnalyzerOptions {
  /** Map column names to field types for validation. If not provided, auto-detection is attempted. */
  columnMapping?: ColumnMapping;
  /** Maximum number of rows to analyze. Defaults to all rows. */
  maxRows?: number;
  /** Whether the first row is a header row. Defaults to true. */
  hasHeaders?: boolean;
  /** CSV delimiter character. Defaults to auto-detect (comma, semicolon, tab). */
  delimiter?: string;
}

