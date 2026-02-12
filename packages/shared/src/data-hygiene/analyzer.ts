/**
 * Main File Analyzer
 * Orchestrates encoding detection, hidden character detection, field validation,
 * and CSV parsing to produce a comprehensive AnalysisReport.
 */

import { detectEncoding, detectBOM } from './encoding.js';
import { detectHiddenCharacters } from './hidden-chars.js';
import { validateField, findDuplicates } from './field-validators.js';
import { parseCSV } from './csv-parser.js';
import {
  IssueType,
  IssueSeverity,
  FieldType,
  type AnalysisReport,
  type AnalyzerOptions,
  type Issue,
  type FieldReport,
  type ColumnMapping,
} from './types.js';

// ─────────────────────────────────────────────────────────────
// Column Type Auto-Detection
// ─────────────────────────────────────────────────────────────

const HEADER_PATTERNS: [RegExp, FieldType][] = [
  [/^(employee[_\s-]?id|emp[_\s-]?id|employee[_\s-]?code|emp[_\s-]?code|staff[_\s-]?id)$/i, FieldType.EMPLOYEE_ID],
  [/^(email|e[_\s-]?mail|email[_\s-]?address)$/i, FieldType.EMAIL],
  [/^(currency|curr|currency[_\s-]?code)$/i, FieldType.CURRENCY],
  [/^(date|hire[_\s-]?date|start[_\s-]?date|end[_\s-]?date|termination[_\s-]?date|birth[_\s-]?date|dob)$/i, FieldType.DATE],
  [/^(salary|base[_\s-]?salary|total[_\s-]?comp|bonus|amount|pay|wage|compensation)$/i, FieldType.NUMBER],
];

function autoDetectColumnType(headerName: string): FieldType | null {
  for (const [pattern, fieldType] of HEADER_PATTERNS) {
    if (pattern.test(headerName.trim())) {
      return fieldType;
    }
  }
  return null;
}

function buildColumnMapping(headers: string[], userMapping?: ColumnMapping): Map<number, FieldType> {
  const mapping = new Map<number, FieldType>();

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]!;
    if (userMapping && userMapping[header]) {
      mapping.set(i, userMapping[header]);
    } else {
      const detected = autoDetectColumnType(header);
      if (detected) {
        mapping.set(i, detected);
      }
    }
  }

  return mapping;
}



// ─────────────────────────────────────────────────────────────
// Hidden Char Type Mapping
// ─────────────────────────────────────────────────────────────

function mapHiddenCharToIssueType(charType: string): IssueType {
  switch (charType) {
    case 'NBSP':
      return IssueType.NBSP;
    case 'ZERO_WIDTH_SPACE':
    case 'ZERO_WIDTH_NON_JOINER':
    case 'ZERO_WIDTH_JOINER':
    case 'ZERO_WIDTH_NO_BREAK_SPACE':
      return IssueType.ZERO_WIDTH;
    case 'LEFT_DOUBLE_QUOTE':
    case 'RIGHT_DOUBLE_QUOTE':
    case 'LEFT_SINGLE_QUOTE':
    case 'RIGHT_SINGLE_QUOTE':
      return IssueType.SMART_QUOTE;
    default:
      return IssueType.CUSTOM;
  }
}

// ─────────────────────────────────────────────────────────────
// Main Analyzer
// ─────────────────────────────────────────────────────────────

/**
 * Analyze a CSV file buffer and produce a comprehensive report.
 *
 * @param buffer - The raw file buffer
 * @param options - Optional analysis configuration
 * @returns AnalysisReport with all detected issues
 */
export function analyzeFile(buffer: Buffer, options: AnalyzerOptions = {}): AnalysisReport {
  const issues: Issue[] = [];

  // Step 1: Encoding detection
  const encoding = detectEncoding(buffer);
  const bom = detectBOM(buffer);

  // Report BOM if present
  if (bom.hasBOM) {
    issues.push({
      row: 0,
      column: 0,
      type: IssueType.BOM,
      severity: IssueSeverity.INFO,
      originalValue: `BOM: ${bom.bomType}`,
      suggestedFix: 'Remove BOM marker',
      description: `File contains a ${bom.bomType} Byte Order Mark`,
    });
  }

  // Report encoding issues
  if (encoding.encoding !== 'UTF-8' || encoding.confidence < 0.8) {
    issues.push({
      row: 0,
      column: 0,
      type: IssueType.ENCODING,
      severity: encoding.encoding === 'UTF-8' ? IssueSeverity.INFO : IssueSeverity.WARNING,
      originalValue: encoding.encoding,
      suggestedFix: 'Convert to UTF-8',
      description: `File encoding detected as ${encoding.encoding} (confidence: ${(encoding.confidence * 100).toFixed(0)}%)`,
    });
  }

  // Step 2: Decode content (strip BOM if present)
  const contentBuffer = bom.hasBOM ? buffer.subarray(bom.bomLength) : buffer;
  const content = contentBuffer.toString('utf-8');

  // Step 3: Parse CSV
  const parsed = parseCSV(content, {
    delimiter: options.delimiter,
    hasHeaders: options.hasHeaders,
  });

  const headers = parsed.headers;
  const rows = options.maxRows ? parsed.rows.slice(0, options.maxRows) : parsed.rows;

  // Step 4: Build column mapping
  const columnMapping = buildColumnMapping(headers, options.columnMapping);

  // Step 5: Initialize field reports
  const fieldReports: FieldReport[] = headers.map((header, idx) => ({
    columnIndex: idx,
    columnName: header,
    fieldType: columnMapping.get(idx) ?? null,
    totalValues: rows.length,
    emptyValues: 0,
    invalidValues: 0,
    issues: [],
  }));

  // Step 6: Analyze each cell
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]!;
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const value = row[colIdx] ?? '';
      const reportRow = rowIdx + 2; // 1-indexed, +1 for header row

      // Hidden character detection
      const hiddenIssues = detectHiddenCharacters(value, reportRow, colIdx);
      for (const hi of hiddenIssues) {
        const issueType = mapHiddenCharToIssueType(hi.charType);
        const issue: Issue = {
          row: reportRow,
          column: colIdx,
          type: issueType,
          severity: IssueSeverity.WARNING,
          originalValue: value,
          suggestedFix: hi.suggestedReplacement || 'Remove character',
          description: `Hidden character "${hi.charType}" at position ${hi.position} (U+${hi.codePoint.toString(16).toUpperCase().padStart(4, '0')})`,
        };
        issues.push(issue);
        if (colIdx < fieldReports.length) {
          fieldReports[colIdx]!.issues.push(issue);
        }
      }

      // Field validation
      const fieldType = columnMapping.get(colIdx);
      if (fieldType) {
        if (!value || value.trim() === '') {
          if (colIdx < fieldReports.length) {
            fieldReports[colIdx]!.emptyValues++;
          }
        }

        const validationResult = validateField(value, fieldType);
        for (const err of validationResult.errors) {
          const issue: Issue = {
            row: reportRow,
            column: colIdx,
            type: err.issueType,
            severity: err.severity,
            originalValue: value,
            suggestedFix: '',
            description: err.message,
          };
          issues.push(issue);
          if (colIdx < fieldReports.length) {
            fieldReports[colIdx]!.issues.push(issue);
            fieldReports[colIdx]!.invalidValues++;
          }
        }
        for (const warn of validationResult.warnings) {
          const issue: Issue = {
            row: reportRow,
            column: colIdx,
            type: warn.issueType,
            severity: warn.severity,
            originalValue: value,
            suggestedFix: '',
            description: warn.message,
          };
          issues.push(issue);
          if (colIdx < fieldReports.length) {
            fieldReports[colIdx]!.issues.push(issue);
          }
        }
      }
    }
  }

  // Step 7: Check for duplicates in EMPLOYEE_ID columns
  for (const [colIdx, fieldType] of columnMapping) {
    if (fieldType === FieldType.EMPLOYEE_ID) {
      const values = rows.map((row) => row[colIdx] ?? '');
      const duplicates = findDuplicates(values);
      for (const [dupValue, indices] of duplicates) {
        for (const idx of indices) {
          const issue: Issue = {
            row: idx + 2, // 1-indexed + header
            column: colIdx,
            type: IssueType.DUPLICATE,
            severity: IssueSeverity.ERROR,
            originalValue: dupValue,
            suggestedFix: 'Ensure unique employee IDs',
            description: `Duplicate employee ID "${dupValue}" found in rows: ${indices.map((i) => i + 2).join(', ')}`,
          };
          issues.push(issue);
          if (colIdx < fieldReports.length) {
            fieldReports[colIdx]!.issues.push(issue);
          }
        }
      }
    }
  }

  // Step 8: Build summary
  const summary = {
    totalIssues: issues.length,
    errorCount: issues.filter((i) => i.severity === IssueSeverity.ERROR).length,
    warningCount: issues.filter((i) => i.severity === IssueSeverity.WARNING).length,
    infoCount: issues.filter((i) => i.severity === IssueSeverity.INFO).length,
  };

  return {
    fileInfo: {
      size: buffer.length,
      totalRows: rows.length,
      totalColumns: headers.length,
      headers,
    },
    encoding,
    issues,
    summary,
    fieldReports,
  };
}