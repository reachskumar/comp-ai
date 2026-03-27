import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { invokePolicyParser, type ConversionResult } from '../graphs/policy-parser-graph';
import { parseCSV } from '@compensation/shared';
import * as ExcelJS from 'exceljs';

/**
 * Extract text from a PDF buffer using pdf-parse.
 * Falls back gracefully if pdf-parse is not available.
 */
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    // Dynamic import to avoid hard dependency — pdf-parse may not be installed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse = ((await import('pdf-parse' as any)) as any).default as (
      buf: Buffer,
    ) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);
    return data.text;
  } catch {
    throw new BadRequestException(
      'PDF parsing failed. Please paste the policy text directly or upload a .txt file.',
    );
  }
}

/**
 * Convert parsed CSV/Excel headers + rows into a markdown table string
 * that the LangGraph policy parser can interpret as structured policy data.
 */
function tabularToText(headers: string[], rows: string[][]): string {
  if (headers.length === 0 || rows.length === 0) {
    throw new BadRequestException('File is empty or has no data rows.');
  }

  // Build a markdown table — the LLM can interpret this as structured policy
  const headerLine = `| ${headers.join(' | ')} |`;
  const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const dataLines = rows.map((row) => {
    const cells = headers.map((_, i) => row[i]?.trim() ?? '');
    return `| ${cells.join(' | ')} |`;
  });

  return [
    'The following is a compensation policy table with structured data:',
    '',
    headerLine,
    separatorLine,
    ...dataLines,
  ].join('\n');
}

/**
 * Service that converts natural language compensation policy documents
 * into structured rule definitions using the LangGraph policy parser.
 * Supports PDF/TXT/CSV/Excel file upload, conversion history, and batch processing.
 */
@Injectable()
export class PolicyConverterService {
  private readonly logger = new Logger(PolicyConverterService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Extract text from an uploaded file (PDF, TXT, CSV, or Excel).
   */
  async extractText(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string> {
    if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
      return extractTextFromPdf(fileBuffer);
    }

    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));

    // CSV / TSV
    if (
      ext === '.csv' ||
      ext === '.tsv' ||
      mimeType === 'text/csv' ||
      mimeType === 'text/tab-separated-values'
    ) {
      const text = fileBuffer.toString('utf-8');
      const parsed = parseCSV(text);
      return tabularToText(parsed.headers, parsed.rows);
    }

    // Excel
    if (
      ext === '.xlsx' ||
      ext === '.xls' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel'
    ) {
      const { headers, rows } = await this.parseExcel(fileBuffer);
      return tabularToText(headers, rows);
    }

    // For text files, just decode the buffer
    return fileBuffer.toString('utf-8');
  }

  /**
   * Parse an Excel file buffer into headers + rows (reuses same logic as RuleUploadService).
   */
  private async parseExcel(buffer: Buffer): Promise<{ headers: string[]; rows: string[][] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) {
      throw new BadRequestException('Excel file has no data. Ensure data is on the first sheet.');
    }

    const headers: string[] = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value ?? '').trim();
    });

    const rows: string[][] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const excelRow = sheet.getRow(r);
      const row: string[] = [];
      for (let c = 0; c < headers.length; c++) {
        row.push(String(excelRow.getCell(c + 1).value ?? '').trim());
      }
      if (row.some((v) => v !== '')) {
        rows.push(row);
      }
    }

    return { headers, rows };
  }

  /**
   * Convert a compensation policy text into structured rules.
   * Persists conversion history to the database.
   *
   * @param policyText - The raw policy document text
   * @param tenantId - Tenant ID for multi-tenant isolation
   * @param userId - User who initiated the conversion
   * @param fileName - Optional original file name
   * @param fileType - Optional file MIME type
   * @returns Extracted rules with confidence scores and review flags
   */
  async convertPolicy(
    policyText: string,
    tenantId: string,
    userId: string,
    fileName?: string,
    fileType?: string,
  ): Promise<ConversionResult> {
    if (!policyText || policyText.trim().length < 10) {
      throw new BadRequestException('Policy text must be at least 10 characters.');
    }

    this.logger.log(
      `Converting policy for tenant=${tenantId} user=${userId} (${policyText.length} chars)`,
    );

    // Create conversion record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversion = await (this.db.client as any).policyConversion.create({
      data: {
        tenantId,
        userId,
        fileName: fileName ?? null,
        fileType: fileType ?? null,
        policyText,
        status: 'PROCESSING',
      },
    });

    try {
      const result = await invokePolicyParser(policyText, tenantId, userId);

      // Update conversion record with results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db.client as any).policyConversion.update({
        where: { id: conversion.id },
        data: {
          status: 'COMPLETED',
          rulesExtracted: result.totalRules,
          result: JSON.parse(JSON.stringify(result)),
          summary: result.summary,
        },
      });

      this.logger.log(
        `Conversion complete: ${result.totalRules} rules extracted, ${result.needsReviewCount} need review`,
      );

      return { ...result, conversionId: conversion.id };
    } catch (error) {
      // Update conversion record with error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.db.client as any).policyConversion.update({
        where: { id: conversion.id },
        data: {
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      throw error;
    }
  }

  /**
   * Convert multiple policy documents in batch.
   */
  async convertBatch(
    items: Array<{ text: string; fileName?: string; fileType?: string }>,
    tenantId: string,
    userId: string,
  ): Promise<ConversionResult[]> {
    this.logger.log(`Batch converting ${items.length} policies for tenant=${tenantId}`);

    const results: ConversionResult[] = [];
    for (const item of items) {
      try {
        const result = await this.convertPolicy(
          item.text,
          tenantId,
          userId,
          item.fileName,
          item.fileType,
        );
        results.push(result);
      } catch (error) {
        this.logger.warn(`Batch item failed: ${item.fileName ?? 'unnamed'}: ${error}`);
        results.push({
          rules: [],
          sections: [],
          summary: `Failed to convert: ${error instanceof Error ? error.message : 'Unknown error'}`,
          needsReviewCount: 0,
          totalRules: 0,
        });
      }
    }

    return results;
  }

  /**
   * Get conversion history for a tenant.
   */
  async getConversionHistory(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
     
    const [data, total] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.db.client as any).policyConversion.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          fileName: true,
          fileType: true,
          status: true,
          rulesExtracted: true,
          rulesAccepted: true,
          rulesRejected: true,
          summary: true,
          createdAt: true,
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.db.client as any).policyConversion.count({
        where: { tenantId },
      }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Update accepted/rejected counts for a conversion.
   */
  async updateConversionCounts(conversionId: string, accepted: number, rejected: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db.client as any).policyConversion.update({
      where: { id: conversionId },
      data: {
        rulesAccepted: accepted,
        rulesRejected: rejected,
      },
    });
  }
}
