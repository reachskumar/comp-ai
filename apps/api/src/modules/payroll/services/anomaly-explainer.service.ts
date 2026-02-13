import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import {
  invokeAnomalyExplainerGraph,
  type AnomalyData,
  type AnomalyExplainerResult,
} from '@compensation/ai';

export interface ExplanationResponse {
  id: string;
  anomalyId: string;
  explanation: string;
  rootCause: string;
  contributingFactors: string[];
  recommendedAction: string;
  confidence: number;
  reasoning: string;
  createdAt: Date;
}

@Injectable()
export class AnomalyExplainerService {
  private readonly logger = new Logger(AnomalyExplainerService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Get a cached explanation for an anomaly, or null if none exists.
   */
  async getExplanation(
    anomalyId: string,
    tenantId: string,
  ): Promise<ExplanationResponse | null> {
    // Verify anomaly belongs to tenant
    const anomaly = await this.db.client.payrollAnomaly.findFirst({
      where: {
        id: anomalyId,
        payrollRun: { tenantId },
      },
      include: { explanation: true },
    });

    if (!anomaly) {
      throw new NotFoundException(`Anomaly ${anomalyId} not found`);
    }

    if (!anomaly.explanation) return null;

    const e = anomaly.explanation;
    return {
      id: e.id,
      anomalyId: e.anomalyId,
      explanation: e.explanation,
      rootCause: e.rootCause,
      contributingFactors: e.contributingFactors as string[],
      recommendedAction: e.recommendedAction,
      confidence: e.confidence,
      reasoning: e.reasoning,
      createdAt: e.createdAt,
    };
  }

  /**
   * Generate an AI explanation for a single anomaly.
   * Returns cached result if already explained.
   */
  async explainAnomaly(
    anomalyId: string,
    tenantId: string,
    userId: string,
  ): Promise<ExplanationResponse> {
    // Check cache first
    const cached = await this.getExplanation(anomalyId, tenantId);
    if (cached) return cached;

    // Load anomaly data
    const anomaly = await this.db.client.payrollAnomaly.findFirst({
      where: {
        id: anomalyId,
        payrollRun: { tenantId },
      },
    });

    if (!anomaly) {
      throw new NotFoundException(`Anomaly ${anomalyId} not found`);
    }

    const anomalyData: AnomalyData = {
      id: anomaly.id,
      anomalyType: anomaly.anomalyType,
      severity: anomaly.severity,
      employeeId: anomaly.employeeId,
      details: anomaly.details as Record<string, unknown>,
      payrollRunId: anomaly.payrollRunId,
    };

    this.logger.log(`Generating AI explanation for anomaly ${anomalyId}`);

    let result: AnomalyExplainerResult;
    try {
      const output = await invokeAnomalyExplainerGraph({
        tenantId,
        userId,
        anomalyData,
      });
      result = output.result;
    } catch (error) {
      this.logger.error(`AI explanation failed for anomaly ${anomalyId}`, error);
      // Provide a fallback explanation
      result = {
        explanation: `Anomaly detected: ${anomaly.anomalyType} with ${anomaly.severity} severity. AI analysis is temporarily unavailable.`,
        rootCause: 'Unable to determine root cause — AI service error.',
        contributingFactors: [],
        recommendedAction: 'flag',
        confidence: 0,
        reasoning: 'Fallback due to AI service error.',
      };
    }

    // Store in database
    const saved = await this.db.client.anomalyExplanation.create({
      data: {
        anomalyId: anomaly.id,
        explanation: result.explanation,
        rootCause: result.rootCause,
        contributingFactors: result.contributingFactors,
        recommendedAction: result.recommendedAction,
        confidence: result.confidence,
        reasoning: result.reasoning,
      },
    });

    return {
      id: saved.id,
      anomalyId: saved.anomalyId,
      explanation: saved.explanation,
      rootCause: saved.rootCause,
      contributingFactors: saved.contributingFactors as string[],
      recommendedAction: saved.recommendedAction,
      confidence: saved.confidence,
      reasoning: saved.reasoning,
      createdAt: saved.createdAt,
    };
  }

  /**
   * Batch explain multiple anomalies. Returns results for each.
   */
  async explainBatch(
    anomalyIds: string[],
    tenantId: string,
    userId: string,
  ): Promise<ExplanationResponse[]> {
    const results: ExplanationResponse[] = [];
    for (const id of anomalyIds) {
      try {
        const explanation = await this.explainAnomaly(id, tenantId, userId);
        results.push(explanation);
      } catch (error) {
        this.logger.warn(`Batch explain: skipping anomaly ${id}`, error);
      }
    }
    return results;
  }
}

