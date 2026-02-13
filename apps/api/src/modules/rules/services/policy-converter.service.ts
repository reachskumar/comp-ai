import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import {
  invokePolicyParser,
  type ConversionResult,
} from '../graphs/policy-parser-graph';

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
 * Service that converts natural language compensation policy documents
 * into structured rule definitions using the LangGraph policy parser.
 * Supports PDF/TXT file upload, conversion history, and batch processing.
 */
@Injectable()
export class PolicyConverterService {
  private readonly logger = new Logger(PolicyConverterService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Extract text from an uploaded file (PDF or TXT).
   */
  async extractText(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
      return extractTextFromPdf(fileBuffer);
    }

    // For text files, just decode the buffer
    return fileBuffer.toString('utf-8');
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
  async getConversionHistory(
    tenantId: string,
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  async updateConversionCounts(
    conversionId: string,
    accepted: number,
    rejected: number,
  ) {
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

