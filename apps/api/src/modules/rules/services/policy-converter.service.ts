import { Injectable, Logger } from '@nestjs/common';
import {
  invokePolicyParser,
  type ConversionResult,
} from '../graphs/policy-parser-graph';

/**
 * Service that converts natural language compensation policy documents
 * into structured rule definitions using the LangGraph policy parser.
 */
@Injectable()
export class PolicyConverterService {
  private readonly logger = new Logger(PolicyConverterService.name);

  /**
   * Convert a compensation policy text into structured rules.
   *
   * @param policyText - The raw policy document text
   * @param tenantId - Tenant ID for multi-tenant isolation
   * @param userId - User who initiated the conversion
   * @returns Extracted rules with confidence scores and review flags
   */
  async convertPolicy(
    policyText: string,
    tenantId: string,
    userId: string,
  ): Promise<ConversionResult> {
    this.logger.log(
      `Converting policy for tenant=${tenantId} user=${userId} (${policyText.length} chars)`,
    );

    const result = await invokePolicyParser(policyText, tenantId, userId);

    this.logger.log(
      `Conversion complete: ${result.totalRules} rules extracted, ${result.needsReviewCount} need review`,
    );

    return result;
  }
}

