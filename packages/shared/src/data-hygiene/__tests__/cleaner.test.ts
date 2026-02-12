import { describe, it, expect } from 'vitest';
import { cleanData } from '../cleaner.js';
import { IssueType, IssueSeverity } from '../types.js';
import type { AnalysisReport, Issue } from '../types.js';


// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeReport(issues: Issue[] = [], headers: string[] = ['id', 'name']): AnalysisReport {
  return {
    fileInfo: { size: 100, totalRows: 1, totalColumns: headers.length, headers },
    encoding: { encoding: 'UTF-8', confidence: 1, hasBOM: false, bomType: 'none' },
    issues,
    summary: { totalIssues: issues.length, errorCount: 0, warningCount: 0, infoCount: 0 },
    fieldReports: [],
  };
}

function makeError(row: number, column: number, description: string): Issue {
  return {
    row,
    column,
    type: IssueType.INVALID_FORMAT,
    severity: IssueSeverity.ERROR,
    originalValue: '',
    suggestedFix: '',
    description,
  };
}

// ─────────────────────────────────────────────────────────────
// BOM Stripping
// ─────────────────────────────────────────────────────────────

describe('cleanData - BOM stripping', () => {
  it('strips BOM from cell values', () => {
    const rows = [['\uFEFFEMP001', 'Alice']];
    const headers = ['id', 'name'];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.cleanedRows[0]![0]).toBe('EMP001');
    expect(result.diffReport).toHaveLength(1);
    expect(result.diffReport[0]!.operations).toContain('stripBOM');
  });

  it('does not strip BOM when disabled', () => {
    const rows = [['\uFEFFEMP001', 'Alice']];
    const headers = ['id', 'name'];
    const result = cleanData(rows, headers, makeReport([], headers), { stripBOM: false });
    // replaceHiddenChars is still on, so BOM (U+FEFF = ZERO_WIDTH_NO_BREAK_SPACE) gets removed
    expect(result.cleanedRows[0]![0]).toBe('EMP001');

    // BOM (U+FEFF) is also in hidden chars list and JS trim() strips it,
    // so disable all three to truly keep it
    const result2 = cleanData(rows, headers, makeReport([], headers), {
      stripBOM: false,
      replaceHiddenChars: false,
      trimWhitespace: false,
    });
    expect(result2.cleanedRows[0]![0]).toBe('\uFEFFEMP001');
  });
});

// ─────────────────────────────────────────────────────────────
// Hidden Character Replacement
// ─────────────────────────────────────────────────────────────

describe('cleanData - hidden character replacement', () => {
  it('replaces NBSP with regular space', () => {
    const rows = [['EMP001', 'Alice\u00A0Smith']];
    const headers = ['id', 'name'];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.cleanedRows[0]![1]).toBe('Alice Smith');
    expect(result.diffReport[0]!.operations).toContain('replaceHiddenChars');
  });

  it('removes zero-width characters', () => {
    const rows = [['EMP\u200B001', 'Alice']];
    const headers = ['id', 'name'];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.cleanedRows[0]![0]).toBe('EMP001');
  });

  it('replaces smart quotes with straight quotes', () => {
    const rows = [['EMP001', '\u201CHello\u201D']];
    const headers = ['id', 'name'];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.cleanedRows[0]![1]).toBe('"Hello"');
  });
});

// ─────────────────────────────────────────────────────────────
// Whitespace Trimming
// ─────────────────────────────────────────────────────────────

describe('cleanData - whitespace trimming', () => {
  it('trims leading and trailing whitespace', () => {
    const rows = [['  EMP001  ', '  Alice  ']];
    const headers = ['id', 'name'];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.cleanedRows[0]![0]).toBe('EMP001');
    expect(result.cleanedRows[0]![1]).toBe('Alice');
    expect(result.diffReport.length).toBe(2);
    expect(result.diffReport[0]!.operations).toContain('trimWhitespace');
  });

  it('does not trim when disabled', () => {
    const rows = [['  EMP001  ', 'Alice']];
    const headers = ['id', 'name'];
    const result = cleanData(rows, headers, makeReport([], headers), { trimWhitespace: false });

    expect(result.cleanedRows[0]![0]).toBe('  EMP001  ');
  });
});

// ─────────────────────────────────────────────────────────────
// Key Field Rejection
// ─────────────────────────────────────────────────────────────

describe('cleanData - key field rejection', () => {
  it('rejects row when key field has ERROR-level issue', () => {
    const headers = ['employee_id', 'name', 'salary'];
    // Row 0 (0-indexed) = report row 2
    const issues = [makeError(2, 0, 'Invalid employee ID format')];
    const report = makeReport(issues, headers);
    const rows = [['BAD!ID', 'Alice', '50000']];

    const result = cleanData(rows, headers, report, { keyFields: ['employee_id'] });

    expect(result.rejectedRows).toHaveLength(1);
    expect(result.rejectedRows[0]!.decision).toBe('rejected');
    expect(result.rejectedRows[0]!.rejectReasons[0]).toContain('employee_id');
    expect(result.cleanedRows).toHaveLength(0);
  });

  it('does not reject row when key field has no errors', () => {
    const headers = ['employee_id', 'name'];
    const rows = [['EMP001', 'Alice']];
    const result = cleanData(rows, headers, makeReport([], headers), {
      keyFields: ['employee_id'],
    });

    expect(result.rejectedRows).toHaveLength(0);
    expect(result.cleanedRows).toHaveLength(1);
  });

  it('key field matching is case-insensitive', () => {
    const headers = ['Employee_ID', 'Name'];
    const issues = [makeError(2, 0, 'Duplicate')];
    const rows = [['DUP001', 'Alice']];

    const result = cleanData(rows, headers, makeReport(issues, headers), {
      keyFields: ['employee_id'],
    });

    expect(result.rejectedRows).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Text Field Safe Normalization
// ─────────────────────────────────────────────────────────────

describe('cleanData - text field normalization', () => {
  it('normalizes text fields without rejecting', () => {
    const headers = ['id', 'description'];
    const rows = [['EMP001', '  Hello\u00A0World  ']];
    // Even if there's an ERROR on the text field, it should NOT reject
    const issues = [makeError(2, 1, 'Some text error')];
    const report = makeReport(issues, headers);

    const result = cleanData(rows, headers, report, {
      textFields: ['description'],
    });

    expect(result.rejectedRows).toHaveLength(0);
    expect(result.cleanedRows[0]![1]).toBe('Hello World');
    expect(result.allRows[0]!.decision).toBe('cleaned');
  });
});

// ─────────────────────────────────────────────────────────────
// Mixed Row Decisions
// ─────────────────────────────────────────────────────────────

describe('cleanData - row decisions', () => {
  it('marks row as cleaned when cells are modified and key field is valid', () => {
    const headers = ['employee_id', 'name'];
    const rows = [['EMP001', '  Alice\u00A0Smith  ']];
    const result = cleanData(rows, headers, makeReport([], headers), {
      keyFields: ['employee_id'],
    });

    expect(result.allRows[0]!.decision).toBe('cleaned');
    expect(result.cleanedRows).toHaveLength(1);
  });

  it('marks row as unchanged when nothing changes', () => {
    const headers = ['id', 'name'];
    const rows = [['EMP001', 'Alice']];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.allRows[0]!.decision).toBe('unchanged');
    expect(result.cleanedRows).toHaveLength(1);
    expect(result.diffReport).toHaveLength(0);
  });

  it('handles mix of cleaned, rejected, and unchanged rows', () => {
    const headers = ['employee_id', 'name'];
    // Row 0 → report row 2: has error on key field → rejected
    // Row 1 → report row 3: clean → unchanged
    // Row 2 → report row 4: has NBSP → cleaned
    const issues = [makeError(2, 0, 'Invalid ID')];
    const report = makeReport(issues, headers);
    const rows = [
      ['BAD', 'Alice'],
      ['EMP002', 'Bob'],
      ['EMP003', 'Charlie\u00A0Brown'],
    ];

    const result = cleanData(rows, headers, report, { keyFields: ['employee_id'] });

    expect(result.summary.rejectedRows).toBe(1);
    expect(result.summary.unchangedRows).toBe(1);
    expect(result.summary.cleanedRows).toBe(1);
    expect(result.cleanedRows).toHaveLength(2); // unchanged + cleaned
    expect(result.rejectedRows).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// Summary Accuracy
// ─────────────────────────────────────────────────────────────

describe('cleanData - summary', () => {
  it('produces accurate summary counts', () => {
    const headers = ['id', 'name', 'dept'];
    const rows = [
      ['EMP001', '  Alice  ', 'Engineering'],
      ['EMP002', 'Bob', 'Sales'],
      ['EMP003', 'Charlie\u00A0Brown', '  HR  '],
    ];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.summary.totalRows).toBe(3);
    // Row 0: name trimmed → cleaned
    // Row 1: nothing → unchanged
    // Row 2: name NBSP replaced, dept trimmed → cleaned
    expect(result.summary.cleanedRows).toBe(2);
    expect(result.summary.unchangedRows).toBe(1);
    expect(result.summary.rejectedRows).toBe(0);
    expect(result.summary.totalCellsModified).toBeGreaterThan(0);
  });

  it('tracks operation counts correctly', () => {
    const headers = ['id', 'name'];
    const rows = [
      ['\uFEFFEMP001', '  Alice\u00A0Smith  '],
      ['EMP002', '\u201CHello\u201D'],
    ];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.summary.operationCounts['stripBOM']).toBe(1);
    expect(result.summary.operationCounts['replaceHiddenChars']).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Diff Report
// ─────────────────────────────────────────────────────────────

describe('cleanData - diff report', () => {
  it('contains all cell-level changes', () => {
    const headers = ['id', 'name'];
    const rows = [['  EMP001  ', '  Alice\u00A0Smith  ']];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.diffReport.length).toBeGreaterThanOrEqual(2);
    for (const diff of result.diffReport) {
      expect(diff.columnName).toBeDefined();
      expect(diff.originalValue).not.toBe(diff.cleanedValue);
      expect(diff.operations.length).toBeGreaterThan(0);
    }
  });

  it('includes correct column names in diffs', () => {
    const headers = ['employee_id', 'full_name'];
    const rows = [['  EMP001  ', 'Alice']];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.diffReport[0]!.columnName).toBe('employee_id');
  });
});

// ─────────────────────────────────────────────────────────────
// Edge Cases
// ─────────────────────────────────────────────────────────────

describe('cleanData - edge cases', () => {
  it('handles empty rows array', () => {
    const headers = ['id', 'name'];
    const result = cleanData([], headers, makeReport([], headers));

    expect(result.cleanedRows).toHaveLength(0);
    expect(result.rejectedRows).toHaveLength(0);
    expect(result.summary.totalRows).toBe(0);
  });

  it('handles single column', () => {
    const headers = ['id'];
    const rows = [['  EMP001  '], ['EMP002']];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.cleanedRows).toHaveLength(2);
    expect(result.cleanedRows[0]![0]).toBe('EMP001');
    expect(result.cleanedRows[1]![0]).toBe('EMP002');
  });

  it('handles all rows rejected', () => {
    const headers = ['employee_id', 'name'];
    const issues = [
      makeError(2, 0, 'Invalid ID'),
      makeError(3, 0, 'Invalid ID'),
    ];
    const rows = [['BAD1', 'Alice'], ['BAD2', 'Bob']];
    const result = cleanData(rows, headers, makeReport(issues, headers), {
      keyFields: ['employee_id'],
    });

    expect(result.cleanedRows).toHaveLength(0);
    expect(result.rejectedRows).toHaveLength(2);
    expect(result.summary.rejectedRows).toBe(2);
  });

  it('handles all rows clean (no changes needed)', () => {
    const headers = ['id', 'name'];
    const rows = [['EMP001', 'Alice'], ['EMP002', 'Bob']];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.cleanedRows).toHaveLength(2);
    expect(result.rejectedRows).toHaveLength(0);
    expect(result.summary.unchangedRows).toBe(2);
    expect(result.diffReport).toHaveLength(0);
  });

  it('handles rows with fewer columns than headers', () => {
    const headers = ['id', 'name', 'dept'];
    const rows = [['EMP001']]; // missing name and dept
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.cleanedRows).toHaveLength(1);
    expect(result.cleanedRows[0]).toHaveLength(1);
  });

  it('preserves headers in result', () => {
    const headers = ['employee_id', 'full_name', 'department'];
    const rows = [['EMP001', 'Alice', 'Engineering']];
    const result = cleanData(rows, headers, makeReport([], headers));

    expect(result.headers).toEqual(headers);
  });
});

// ─────────────────────────────────────────────────────────────
// Performance
// ─────────────────────────────────────────────────────────────

describe('cleanData - performance', () => {
  it('processes 50k rows in under 5 seconds', () => {
    const headers = ['id', 'name', 'email', 'salary', 'dept'];
    const rows: string[][] = [];
    for (let i = 0; i < 50000; i++) {
      rows.push([
        `EMP${String(i).padStart(6, '0')}`,
        `Employee\u00A0${i}`,
        `emp${i}@example.com`,
        `${50000 + i}`,
        '  Engineering  ',
      ]);
    }
    const report = makeReport([], headers);

    const start = performance.now();
    const result = cleanData(rows, headers, report);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5000);
    expect(result.summary.totalRows).toBe(50000);
    expect(result.summary.cleanedRows).toBe(50000); // all have NBSP or whitespace
  });
});

