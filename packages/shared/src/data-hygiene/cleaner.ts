/**
 * Data Cleaning Pipeline
 * Takes parsed CSV rows + analysis report and produces cleaned output
 * with cell-level diffs, row-level decisions, and rejection tracking.
 */

import { replaceHiddenCharacters } from './hidden-chars.js';
import { IssueSeverity } from './types.js';
import type { AnalysisReport, Issue } from './types.js';
import {
  DEFAULT_CLEANING_CONFIG,
  type CleaningConfig,
  type CleaningResult,
  type CleaningSummary,
  type CellDiff,
  type RowResult,
  type RowDecision,
} from './cleaner-types.js';

// BOM character (U+FEFF)
const BOM = '\uFEFF';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Build a lookup of ERROR-level issues keyed by "row:column".
 * Analysis report rows are 1-indexed with header as row 1,
 * so data row 0 (0-indexed) = report row 2.
 */
function buildErrorIndex(issues: Issue[]): Map<string, Issue[]> {
  const index = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (issue.severity === IssueSeverity.ERROR) {
      const key = `${issue.row}:${issue.column}`;
      const existing = index.get(key);
      if (existing) {
        existing.push(issue);
      } else {
        index.set(key, [issue]);
      }
    }
  }
  return index;
}

/**
 * Clean a single cell value and track what operations were applied.
 */
function cleanCell(
  value: string,
  config: CleaningConfig,
): { cleaned: string; operations: string[] } {
  let cleaned = value;
  const operations: string[] = [];

  // Strip BOM
  if (config.stripBOM && cleaned.startsWith(BOM)) {
    cleaned = cleaned.slice(1);
    operations.push('stripBOM');
  }

  // Replace hidden characters (NBSP, zero-width, smart quotes, etc.)
  if (config.replaceHiddenChars) {
    const replaced = replaceHiddenCharacters(cleaned);
    if (replaced !== cleaned) {
      cleaned = replaced;
      operations.push('replaceHiddenChars');
    }
  }

  // Trim whitespace
  if (config.trimWhitespace) {
    const trimmed = cleaned.trim();
    if (trimmed !== cleaned) {
      cleaned = trimmed;
      operations.push('trimWhitespace');
    }
  }

  return { cleaned, operations };
}

// ─────────────────────────────────────────────────────────────
// Main Pipeline
// ─────────────────────────────────────────────────────────────

/**
 * Clean parsed CSV data using analysis results and configuration.
 *
 * @param rows - Parsed data rows (no header row)
 * @param headers - Column headers
 * @param analysisReport - Output from analyzeFile()
 * @param config - Optional partial cleaning configuration
 * @returns CleaningResult with cleaned data, rejections, diffs, and summary
 */
export function cleanData(
  rows: string[][],
  headers: string[],
  analysisReport: AnalysisReport,
  config?: Partial<CleaningConfig>,
): CleaningResult {
  const mergedConfig: CleaningConfig = { ...DEFAULT_CLEANING_CONFIG, ...config };

  // Build error index from analysis report
  const errorIndex = buildErrorIndex(analysisReport.issues);

  // Build column name → index lookup for key/text fields
  const keyFieldIndices = new Set<number>();
  const textFieldIndices = new Set<number>();
  for (let i = 0; i < headers.length; i++) {
    const headerLower = headers[i]!.toLowerCase();
    if (mergedConfig.keyFields.some((kf) => kf.toLowerCase() === headerLower)) {
      keyFieldIndices.add(i);
    }
    if (mergedConfig.textFields.some((tf) => tf.toLowerCase() === headerLower)) {
      textFieldIndices.add(i);
    }
  }

  const allRows: RowResult[] = [];
  const allDiffs: CellDiff[] = [];
  const cleanedOutputRows: string[][] = [];
  const rejectedRows: RowResult[] = [];
  const operationCounts: Record<string, number> = {};

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]!;
    const reportRow = rowIdx + 2; // analysis report is 1-indexed, header = row 1

    const cleanedRow: string[] = [];
    const diffs: CellDiff[] = [];
    const rejectReasons: string[] = [];
    let hasChanges = false;

    // Check key fields for ERROR-level issues → reject
    for (const colIdx of keyFieldIndices) {
      const key = `${reportRow}:${colIdx}`;
      const errors = errorIndex.get(key);
      if (errors && errors.length > 0) {
        for (const err of errors) {
          rejectReasons.push(
            `Key field "${headers[colIdx]}" has error: ${err.description}`,
          );
        }
      }
    }

    const isRejected = rejectReasons.length > 0;

    // Clean each cell
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const originalValue = row[colIdx] ?? '';
      const { cleaned, operations } = cleanCell(originalValue, mergedConfig);

      cleanedRow.push(cleaned);

      if (operations.length > 0) {
        hasChanges = true;
        const diff: CellDiff = {
          row: rowIdx + 1, // 1-indexed data row (after header)
          column: colIdx,
          columnName: headers[colIdx] ?? `Column ${colIdx}`,
          originalValue,
          cleanedValue: cleaned,
          operations,
        };
        diffs.push(diff);
        allDiffs.push(diff);

        // Track operation counts
        for (const op of operations) {
          operationCounts[op] = (operationCounts[op] ?? 0) + 1;
        }
      }
    }

    // Determine row decision
    let decision: RowDecision;
    if (isRejected) {
      decision = 'rejected';
    } else if (hasChanges) {
      decision = 'cleaned';
    } else {
      decision = 'unchanged';
    }

    const rowResult: RowResult = {
      rowIndex: rowIdx + 1, // 1-indexed
      decision,
      row: cleanedRow,
      diffs,
      rejectReasons,
    };

    allRows.push(rowResult);

    if (decision === 'rejected') {
      rejectedRows.push(rowResult);
    } else {
      cleanedOutputRows.push(cleanedRow);
    }
  }

  // Build summary
  const summary: CleaningSummary = {
    totalRows: rows.length,
    cleanedRows: allRows.filter((r) => r.decision === 'cleaned').length,
    rejectedRows: rejectedRows.length,
    unchangedRows: allRows.filter((r) => r.decision === 'unchanged').length,
    totalCellsModified: allDiffs.length,
    operationCounts,
  };

  return {
    cleanedRows: cleanedOutputRows,
    rejectedRows,
    allRows,
    diffReport: allDiffs,
    summary,
    headers,
  };
}

