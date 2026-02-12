/**
 * Policy Parser Graph — LangGraph multi-node agent that converts
 * natural language compensation policy documents into structured rule definitions.
 *
 * Nodes:
 *   1. classifySections — classify policy text into rule-type sections
 *   2. extractRules — extract specific rules with conditions/actions per section
 *   3. mapToSchema — map extracted rules to the Rule schema with confidence scores
 *   4. validateRules — validate rules and flag low-confidence ones for review
 *
 * The graph compiles without an API key; LLM calls happen only at runtime.
 */

import { Annotation } from '@langchain/langgraph';
import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import {
  BaseAgentState,
  createAgentGraph,
  loadAIConfig,
  resolveModelConfig,
  type CreateGraphOptions,
} from '@compensation/ai';
import type {
  RuleType,
  RuleCondition,
  RuleAction,
} from '@compensation/shared';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface PolicySection {
  category: RuleType;
  text: string;
  lineNumbers?: [number, number];
}

export interface ExtractedRule {
  name: string;
  description: string;
  ruleType: RuleType;
  conditions: RuleCondition[];
  actions: RuleAction[];
  priority: number;
  confidence: number;
  needsReview: boolean;
  sourceText: string;
}

export interface ConversionResult {
  rules: ExtractedRule[];
  sections: PolicySection[];
  summary: string;
  needsReviewCount: number;
  totalRules: number;
}

// ─────────────────────────────────────────────────────────────
// Graph State
// ─────────────────────────────────────────────────────────────

const PolicyParserState = Annotation.Root({
  ...BaseAgentState.spec,
  policyText: Annotation<string>,
  sections: Annotation<PolicySection[]>({
    reducer: (_: PolicySection[], update: PolicySection[]) => update,
    default: () => [],
  }),
  extractedRules: Annotation<ExtractedRule[]>({
    reducer: (_: ExtractedRule[], update: ExtractedRule[]) => update,
    default: () => [],
  }),
  validatedRules: Annotation<ExtractedRule[]>({
    reducer: (_: ExtractedRule[], update: ExtractedRule[]) => update,
    default: () => [],
  }),
});

type PolicyParserStateType = typeof PolicyParserState.State;

// ─────────────────────────────────────────────────────────────
// System Prompts
// ─────────────────────────────────────────────────────────────

const CLASSIFY_PROMPT = `You are a compensation policy analyst. Given a compensation policy document,
classify it into sections by rule type. Each section should be categorized as one of:
MERIT, BONUS, LTI, PRORATION, CAP, FLOOR, ELIGIBILITY, CUSTOM.

Return a JSON array of objects with:
- "category": the RuleType
- "text": the relevant policy text for that section
- "lineNumbers": optional [start, end] line numbers

Only return valid JSON. No markdown fences.`;

const EXTRACT_PROMPT = `You are a compensation rules extraction expert. Given classified policy sections,
extract specific rules with conditions, thresholds, and actions.

For each rule, extract:
- "name": short descriptive name
- "description": what the rule does
- "ruleType": matching the section category
- "conditions": array of { "field": string, "operator": one of (eq|neq|gt|gte|lt|lte|in|notIn|between|contains|startsWith|matches), "value": any }
- "actions": array of { "type": one of (setMerit|setBonus|setLTI|applyMultiplier|applyFloor|applyCap|flag|block), "params": object }
- "priority": number (lower = higher priority)
- "confidence": 0-1 how confident you are in the extraction
- "sourceText": the original policy text this was extracted from

Only return valid JSON array. No markdown fences.`;

// ─────────────────────────────────────────────────────────────
// Node Factories (capture model via closure)
// ─────────────────────────────────────────────────────────────

function createClassifySectionsNode(model: ChatOpenAI) {
  return async (state: PolicyParserStateType): Promise<{ sections: PolicySection[]; messages: BaseMessage[] }> => {
    const response = await model.invoke([
      new SystemMessage(CLASSIFY_PROMPT),
      new HumanMessage(state.policyText),
    ]);

    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    let sections: PolicySection[];
    try {
      sections = JSON.parse(content) as PolicySection[];
    } catch {
      sections = [{ category: 'CUSTOM' as RuleType, text: state.policyText }];
    }

    return { sections, messages: [response] };
  };
}

function createExtractRulesNode(model: ChatOpenAI) {
  return async (state: PolicyParserStateType): Promise<{ extractedRules: ExtractedRule[]; messages: BaseMessage[] }> => {
    const sectionsJson = JSON.stringify(state.sections, null, 2);
    const response = await model.invoke([
      new SystemMessage(EXTRACT_PROMPT),
      new HumanMessage(`Policy sections:\n${sectionsJson}`),
    ]);

    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    let extractedRules: ExtractedRule[];
    try {
      extractedRules = JSON.parse(content) as ExtractedRule[];
    } catch {
      extractedRules = [];
    }

    return { extractedRules, messages: [response] };
  };
}

function createMapToSchemaNode() {
  return async (state: PolicyParserStateType): Promise<{ extractedRules: ExtractedRule[] }> => {
    // Map extracted rules to ensure they conform to the schema
    const mapped = state.extractedRules.map((rule, index) => ({
      name: rule.name || `Rule ${index + 1}`,
      description: rule.description || '',
      ruleType: rule.ruleType || ('CUSTOM' as RuleType),
      conditions: Array.isArray(rule.conditions) ? rule.conditions : [],
      actions: Array.isArray(rule.actions) ? rule.actions : [],
      priority: typeof rule.priority === 'number' ? rule.priority : index,
      confidence: typeof rule.confidence === 'number' ? Math.max(0, Math.min(1, rule.confidence)) : 0.5,
      needsReview: (typeof rule.confidence === 'number' ? rule.confidence : 0.5) < 0.7,
      sourceText: rule.sourceText || '',
    }));

    return { extractedRules: mapped };
  };
}

function createValidateRulesNode() {
  return async (state: PolicyParserStateType): Promise<{ validatedRules: ExtractedRule[] }> => {
    const validRuleTypes = new Set<string>([
      'MERIT', 'BONUS', 'LTI', 'PRORATION', 'CAP', 'FLOOR', 'ELIGIBILITY', 'CUSTOM',
    ]);
    const validActionTypes = new Set<string>([
      'setMerit', 'setBonus', 'setLTI', 'applyMultiplier', 'applyFloor', 'applyCap', 'flag', 'block',
    ]);
    const validOperators = new Set<string>([
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'contains', 'startsWith', 'matches',
    ]);

    const validated = state.extractedRules.map((rule) => {
      let confidence = rule.confidence;

      // Validate rule type
      if (!validRuleTypes.has(rule.ruleType)) {
        confidence = Math.min(confidence, 0.3);
      }

      // Validate conditions
      for (const cond of rule.conditions) {
        if (!cond.field || !validOperators.has(cond.operator)) {
          confidence = Math.min(confidence, 0.5);
        }
      }

      // Validate actions
      for (const action of rule.actions) {
        if (!validActionTypes.has(action.type)) {
          confidence = Math.min(confidence, 0.4);
        }
      }

      return {
        ...rule,
        confidence,
        needsReview: confidence < 0.7,
      };
    });

    return { validatedRules: validated };
  };
}

// ─────────────────────────────────────────────────────────────
// Graph Builder
// ─────────────────────────────────────────────────────────────

/**
 * Build and compile the policy parser graph.
 * The graph compiles without an API key; LLM calls happen only at runtime.
 */
export async function buildPolicyParserGraph(options: CreateGraphOptions = {}) {
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'policy-parser'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
  });

  return createAgentGraph(
    {
      name: 'policy-parser-graph',
      graphType: 'policy-parser',
      stateSchema: PolicyParserState,
      nodes: {
        classifySections: createClassifySectionsNode(model),
        extractRules: createExtractRulesNode(model),
        mapToSchema: createMapToSchemaNode(),
        validateRules: createValidateRulesNode(),
      },
      edges: [
        [START, 'classifySections'],
        ['classifySections', 'extractRules'],
        ['extractRules', 'mapToSchema'],
        ['mapToSchema', 'validateRules'],
        ['validateRules', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Invoke the policy parser graph with a policy text string.
 */
export async function invokePolicyParser(
  policyText: string,
  tenantId: string,
  userId: string,
  options: CreateGraphOptions = {},
): Promise<ConversionResult> {
  const { graph } = await buildPolicyParserGraph(options);

  const result = await graph.invoke({
    tenantId,
    userId,
    policyText,
    messages: [new HumanMessage(policyText)],
    metadata: {},
    sections: [],
    extractedRules: [],
    validatedRules: [],
  });

  const validatedRules = (result.validatedRules as ExtractedRule[] | undefined) ?? [];
  const sections = (result.sections as PolicySection[] | undefined) ?? [];
  const needsReviewCount = validatedRules.filter((r) => r.needsReview).length;

  return {
    rules: validatedRules,
    sections,
    summary: `Extracted ${validatedRules.length} rules from ${sections.length} policy sections. ${needsReviewCount} rules need human review.`,
    needsReviewCount,
    totalRules: validatedRules.length,
  };
}

