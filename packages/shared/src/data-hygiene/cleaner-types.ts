/**
 * Cleaning Pipeline Types
 * Types for the data cleaning pipeline that transforms analysis results
 * into cleaned output with diff tracking and rejection reasons.
 */

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

export interface CleaningConfig {
  stripBOM: boolean;
  normalizeEncoding: boolean;
  replaceHiddenChars: boolean;
  normalizeSmartQuotes: boolean;
  trimWhitespace: boolean;
  keyFields: string[];
  textFields: string[];
}

export const DEFAULT_CLEANING_CONFIG: CleaningConfig = {
  stripBOM: true,
  normalizeEncoding: true,
  replaceHiddenChars: true,
  normalizeSmartQuotes: true,
  trimWhitespace: true,
  keyFields: [],
  textFields: [],
};

// ─────────────────────────────────────────────────────────────
// Cell-Level Diff
// ─────────────────────────────────────────────────────────────

export interface CellDiff {
  row: number;
  column: number;
  columnName: string;
  originalValue: string;
  cleanedValue: string;
  operations: string[];
}

// ─────────────────────────────────────────────────────────────
// Row-Level Results
// ─────────────────────────────────────────────────────────────

export type RowDecision = 'cleaned' | 'rejected' | 'unchanged';

export interface RowResult {
  rowIndex: number;
  decision: RowDecision;
  row: string[];
  diffs: CellDiff[];
  rejectReasons: string[];
}

// ─────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────

export interface CleaningSummary {
  totalRows: number;
  cleanedRows: number;
  rejectedRows: number;
  unchangedRows: number;
  totalCellsModified: number;
  operationCounts: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────
// Final Result
// ─────────────────────────────────────────────────────────────

export interface CleaningResult {
  cleanedRows: string[][];
  rejectedRows: RowResult[];
  allRows: RowResult[];
  diffReport: CellDiff[];
  summary: CleaningSummary;
  headers: string[];
}

