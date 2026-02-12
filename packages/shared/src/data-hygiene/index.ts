/**
 * Data Hygiene Module
 * File analysis engine for detecting encoding issues, hidden characters,
 * and data quality problems in CSV files.
 */

// Types
export {
  IssueType,
  IssueSeverity,
  FieldType,
  type BOMType,
  type EncodingResult,
  type HiddenCharacterIssue,
  type ValidationResult,
  type ValidationError,
  type FieldValidationRules,
  type Issue,
  type FieldReport,
  type FileInfo,
  type AnalysisSummary,
  type AnalysisReport,
  type ColumnMapping,
  type AnalyzerOptions,
} from './types.js';

// Encoding detection
export { detectEncoding, detectBOM } from './encoding.js';

// Hidden character detection
export { detectHiddenCharacters, replaceHiddenCharacters } from './hidden-chars.js';

// Field validation
export { validateField, findDuplicates } from './field-validators.js';

// CSV parsing
export { parseCSV, detectDelimiter, type ParsedCSV, type CSVParseOptions } from './csv-parser.js';

// Main analyzer
export { analyzeFile } from './analyzer.js';

// Cleaning pipeline
export { cleanData } from './cleaner.js';
export {
  DEFAULT_CLEANING_CONFIG,
  type CleaningConfig,
  type CellDiff,
  type RowDecision,
  type RowResult,
  type CleaningSummary,
  type CleaningResult,
} from './cleaner-types.js';

