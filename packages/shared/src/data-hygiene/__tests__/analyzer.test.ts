import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeFile } from '../analyzer.js';
import { IssueType, IssueSeverity, FieldType } from '../types.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES, name));
}

describe('analyzeFile', () => {
  describe('clean CSV', () => {
    it('produces a report with no errors for clean data', () => {
      const buffer = loadFixture('clean.csv');
      const report = analyzeFile(buffer);

      expect(report.fileInfo.totalRows).toBe(5);
      expect(report.fileInfo.totalColumns).toBe(6);
      expect(report.fileInfo.headers).toContain('employee_id');
      expect(report.fileInfo.headers).toContain('email');
      expect(report.encoding.encoding).toBe('UTF-8');
      expect(report.encoding.hasBOM).toBe(false);
      expect(report.summary.errorCount).toBe(0);
    });
  });

  describe('BOM detection', () => {
    it('detects UTF-8 BOM in CSV file', () => {
      const buffer = loadFixture('bom-utf8.csv');
      const report = analyzeFile(buffer);

      expect(report.encoding.hasBOM).toBe(true);
      expect(report.encoding.bomType).toBe('UTF-8');
      const bomIssues = report.issues.filter((i) => i.type === IssueType.BOM);
      expect(bomIssues.length).toBeGreaterThan(0);
      expect(bomIssues[0]!.severity).toBe(IssueSeverity.INFO);
    });
  });

  describe('hidden characters', () => {
    it('detects hidden characters in CSV cells', () => {
      const buffer = loadFixture('hidden-chars.csv');
      const report = analyzeFile(buffer);

      const nbspIssues = report.issues.filter((i) => i.type === IssueType.NBSP);
      const zwIssues = report.issues.filter((i) => i.type === IssueType.ZERO_WIDTH);
      const sqIssues = report.issues.filter((i) => i.type === IssueType.SMART_QUOTE);

      expect(nbspIssues.length).toBeGreaterThan(0);
      expect(zwIssues.length).toBeGreaterThan(0);
      expect(sqIssues.length).toBeGreaterThan(0);
    });
  });

  describe('bad emails', () => {
    it('detects invalid email formats', () => {
      const buffer = loadFixture('bad-emails.csv');
      const report = analyzeFile(buffer);

      const emailErrors = report.issues.filter(
        (i) => i.type === IssueType.INVALID_FORMAT && i.description.includes('email'),
      );
      expect(emailErrors.length).toBeGreaterThan(0);
    });
  });

  describe('ambiguous dates', () => {
    it('warns on ambiguous date formats', () => {
      const buffer = loadFixture('ambiguous-dates.csv');
      const report = analyzeFile(buffer);

      const dateWarnings = report.issues.filter(
        (i) => i.severity === IssueSeverity.WARNING && i.description.includes('Ambiguous'),
      );
      expect(dateWarnings.length).toBeGreaterThan(0);

      // "not-a-date" should be an error
      const dateErrors = report.issues.filter(
        (i) => i.type === IssueType.INVALID_FORMAT && i.description.includes('not-a-date'),
      );
      expect(dateErrors.length).toBeGreaterThan(0);
    });
  });

  describe('mixed encoding', () => {
    it('detects non-UTF-8 encoding', () => {
      const buffer = loadFixture('mixed-encoding.csv');
      const report = analyzeFile(buffer);

      // Should detect encoding issues since the file has Latin-1 chars
      expect(report.encoding.encoding).not.toBe('UTF-8');
    });
  });

  describe('edge cases', () => {
    it('handles empty file', () => {
      const buffer = Buffer.alloc(0);
      const report = analyzeFile(buffer);

      expect(report.fileInfo.totalRows).toBe(0);
      expect(report.fileInfo.totalColumns).toBe(0);
      expect(report.issues).toBeDefined();
    });

    it('handles headers only', () => {
      const buffer = Buffer.from('employee_id,email,salary\n');
      const report = analyzeFile(buffer);

      expect(report.fileInfo.totalRows).toBe(0);
      expect(report.fileInfo.totalColumns).toBe(3);
      expect(report.fileInfo.headers).toEqual(['employee_id', 'email', 'salary']);
    });

    it('handles single row', () => {
      const buffer = Buffer.from('employee_id,email\nEMP-001,test@example.com\n');
      const report = analyzeFile(buffer);

      expect(report.fileInfo.totalRows).toBe(1);
    });

    it('respects maxRows option', () => {
      const rows = ['employee_id,email'];
      for (let i = 0; i < 100; i++) {
        rows.push(`EMP-${i},user${i}@example.com`);
      }
      const buffer = Buffer.from(rows.join('\n'));
      const report = analyzeFile(buffer, { maxRows: 10 });

      expect(report.fileInfo.totalRows).toBe(10);
    });

    it('handles column mapping override', () => {
      const buffer = Buffer.from('id,mail,pay\nEMP-001,test@example.com,85000\n');
      const report = analyzeFile(buffer, {
        columnMapping: {
          id: FieldType.EMPLOYEE_ID,
          mail: FieldType.EMAIL,
          pay: FieldType.NUMBER,
        },
      });

      // Should validate fields based on mapping
      expect(report.fieldReports[0]!.fieldType).toBe(FieldType.EMPLOYEE_ID);
      expect(report.fieldReports[1]!.fieldType).toBe(FieldType.EMAIL);
      expect(report.fieldReports[2]!.fieldType).toBe(FieldType.NUMBER);
    });

    it('detects duplicate employee IDs', () => {
      const csv = 'employee_id,email\nEMP-001,a@example.com\nEMP-002,b@example.com\nEMP-001,c@example.com\n';
      const buffer = Buffer.from(csv);
      const report = analyzeFile(buffer);

      const dupIssues = report.issues.filter((i) => i.type === IssueType.DUPLICATE);
      expect(dupIssues.length).toBeGreaterThan(0);
    });
  });
});

