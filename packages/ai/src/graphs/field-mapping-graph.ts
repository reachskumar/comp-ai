/**
 * Field Mapping Graph — AI-powered field mapping suggestions.
 *
 * Flow: START → analyzeSchemas → suggestMappings → scoreConfidence → END
 *
 * Given a source system schema and the target Compport schema, the AI
 * suggests field mappings with confidence scores, type conversions,
 * format transformations, and default values.
 */

import { Annotation } from '@langchain/langgraph';
import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface FieldSchema {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  sampleValues?: string[];
}

export interface SuggestedMapping {
  sourceField: string;
  targetField: string;
  confidence: number; // 0-1
  transformType: string;
  transformConfig: Record<string, unknown>;
  reasoning: string;
  defaultValue?: string;
}

export interface FieldMappingGraphInput {
  tenantId: string;
  userId: string;
  connectorType: string;
  sourceFields: FieldSchema[];
  targetFields: FieldSchema[];
}

export interface FieldMappingGraphOutput {
  tenantId: string;
  userId: string;
  suggestions: SuggestedMapping[];
  unmappedSource: string[];
  unmappedTarget: string[];
  overallConfidence: number;
}

// ─────────────────────────────────────────────────────────────
// Graph State
// ─────────────────────────────────────────────────────────────

const FieldMappingState = Annotation.Root({
  ...BaseAgentState.spec,
  connectorType: Annotation<string>,
  sourceFields: Annotation<FieldSchema[]>({
    reducer: (_: FieldSchema[], update: FieldSchema[]) => update,
    default: () => [],
  }),
  targetFields: Annotation<FieldSchema[]>({
    reducer: (_: FieldSchema[], update: FieldSchema[]) => update,
    default: () => [],
  }),
  suggestions: Annotation<SuggestedMapping[]>({
    reducer: (_: SuggestedMapping[], update: SuggestedMapping[]) => update,
    default: () => [],
  }),
  unmappedSource: Annotation<string[]>({
    reducer: (_: string[], update: string[]) => update,
    default: () => [],
  }),
  unmappedTarget: Annotation<string[]>({
    reducer: (_: string[], update: string[]) => update,
    default: () => [],
  }),
  overallConfidence: Annotation<number>({
    reducer: (_: number, update: number) => update,
    default: () => 0,
  }),
});

type FieldMappingStateType = typeof FieldMappingState.State;

const SYSTEM_PROMPT = `You are an expert data integration engineer specializing in HR/compensation systems.
Your task is to analyze source and target field schemas and suggest optimal field mappings.

Guidelines:
- Match fields by name similarity, type compatibility, and semantic meaning
- Consider common HR field naming conventions (e.g., "emp_id" → "employeeId", "first_name" → "firstName")
- Suggest appropriate transform types: direct, date_format, currency, enum_map, uppercase, lowercase, trim, concatenate, split, lookup, default
- Provide confidence scores (0.0-1.0) based on match quality
- For date fields, suggest date_format transforms with ISO target
- For enum fields, suggest enum_map transforms with value mappings
- For name fields that need combining, suggest concatenate transforms
- Always respond with valid JSON only, no markdown fences`;

const MAPPING_PROMPT = `Analyze these schemas and suggest field mappings.

Source System: {connectorType}
Source Fields:
{sourceFields}

Target (Compport) Fields:
{targetFields}

Respond with a JSON object:
{
  "mappings": [
    {
      "sourceField": "source_field_name",
      "targetField": "target_field_name",
      "confidence": 0.95,
      "transformType": "direct",
      "transformConfig": {},
      "reasoning": "Exact name match with compatible types",
      "defaultValue": null
    }
  ],
  "unmappedSource": ["fields_without_targets"],
  "unmappedTarget": ["fields_without_sources"]
}`;

// ─────────────────────────────────────────────────────────────
// Graph Builder
// ─────────────────────────────────────────────────────────────

export async function buildFieldMappingGraph(
  options: CreateGraphOptions = {},
) {
  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'field-mapping'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: 0.1, // Low temperature for consistent mappings
    maxTokens: modelConfig.maxTokens,
  });

  // Node: Suggest mappings using AI
  async function suggestMappingsNode(
    state: FieldMappingStateType,
  ): Promise<Partial<FieldMappingStateType>> {
    const sourceFieldsStr = state.sourceFields
      .map((f) => `  - ${f.name} (${f.type}${f.required ? ', required' : ''}${f.description ? ': ' + f.description : ''}${f.sampleValues?.length ? ', samples: ' + f.sampleValues.join(', ') : ''})`)
      .join('\n');

    const targetFieldsStr = state.targetFields
      .map((f) => `  - ${f.name} (${f.type}${f.required ? ', required' : ''}${f.description ? ': ' + f.description : ''})`)
      .join('\n');

    const prompt = MAPPING_PROMPT
      .replace('{connectorType}', state.connectorType)
      .replace('{sourceFields}', sourceFieldsStr)
      .replace('{targetFields}', targetFieldsStr);

    const response = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(prompt),
    ]);

    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    try {
      // Strip markdown fences if present
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const mappings: SuggestedMapping[] = (parsed.mappings || []).map(
        (m: Record<string, unknown>) => ({
          sourceField: String(m.sourceField || ''),
          targetField: String(m.targetField || ''),
          confidence: Math.min(1, Math.max(0, Number(m.confidence) || 0)),
          transformType: String(m.transformType || 'direct'),
          transformConfig: (m.transformConfig as Record<string, unknown>) || {},
          reasoning: String(m.reasoning || ''),
          defaultValue: m.defaultValue ? String(m.defaultValue) : undefined,
        }),
      );

      const unmappedSource = Array.isArray(parsed.unmappedSource)
        ? parsed.unmappedSource.map(String)
        : [];
      const unmappedTarget = Array.isArray(parsed.unmappedTarget)
        ? parsed.unmappedTarget.map(String)
        : [];

      const avgConfidence = mappings.length > 0
        ? mappings.reduce((sum, m) => sum + m.confidence, 0) / mappings.length
        : 0;

      return {
        suggestions: mappings,
        unmappedSource,
        unmappedTarget,
        overallConfidence: Math.round(avgConfidence * 100) / 100,
        messages: [response],
      };
    } catch {
      // Fallback: return empty suggestions
      return {
        suggestions: [],
        unmappedSource: state.sourceFields.map((f) => f.name),
        unmappedTarget: state.targetFields.map((f) => f.name),
        overallConfidence: 0,
        messages: [response],
      };
    }
  }

  return createAgentGraph(
    {
      name: 'field-mapping-graph',
      graphType: 'field-mapping',
      stateSchema: FieldMappingState,
      nodes: {
        suggestMappings: suggestMappingsNode,
      },
      edges: [
        [START, 'suggestMappings'],
        ['suggestMappings', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Convenience function to invoke the field mapping graph.
 */
export async function invokeFieldMappingGraph(
  input: FieldMappingGraphInput,
  options: CreateGraphOptions = {},
): Promise<FieldMappingGraphOutput> {
  const { graph } = await buildFieldMappingGraph(options);

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    connectorType: input.connectorType,
    sourceFields: input.sourceFields,
    targetFields: input.targetFields,
    messages: [new HumanMessage('Suggest field mappings')],
    metadata: {},
  });

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    suggestions: (result.suggestions as SuggestedMapping[]) ?? [],
    unmappedSource: (result.unmappedSource as string[]) ?? [],
    unmappedTarget: (result.unmappedTarget as string[]) ?? [],
    overallConfidence: (result.overallConfidence as number) ?? 0,
  };
}

