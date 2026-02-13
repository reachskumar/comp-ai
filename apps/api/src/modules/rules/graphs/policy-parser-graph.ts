/**
 * Policy Parser Graph — LangGraph multi-node agent that converts
 * natural language compensation policy documents into structured rule definitions.
 *
 * Nodes:
 *   1. classifySections — classify policy text into rule-type sections
 *   2. extractRules — extract specific rules with conditions/actions per section
 *   3. mapToSchema — map extracted rules to the Rule schema with confidence scores
 *   4. validateRules — validate rules and flag low-confidence ones for review
 *   5. calibrateConfidence — calibrate confidence scores against known patterns
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
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Zod Schemas for Structured Output Validation
// ─────────────────────────────────────────────────────────────

const PolicySectionSchema = z.object({
  category: z.enum(['MERIT', 'BONUS', 'LTI', 'PRORATION', 'CAP', 'FLOOR', 'ELIGIBILITY', 'CUSTOM']),
  text: z.string(),
  lineNumbers: z.tuple([z.number(), z.number()]).optional(),
});

const RuleConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between', 'contains', 'startsWith', 'matches']),
  value: z.unknown(),
});

const RuleActionSchema = z.object({
  type: z.enum(['setMerit', 'setBonus', 'setLTI', 'applyMultiplier', 'applyFloor', 'applyCap', 'flag', 'block']),
  params: z.record(z.string(), z.unknown()),
});

const ExtractedRuleSchema = z.object({
  name: z.string(),
  description: z.string(),
  ruleType: z.enum(['MERIT', 'BONUS', 'LTI', 'PRORATION', 'CAP', 'FLOOR', 'ELIGIBILITY', 'CUSTOM']),
  conditions: z.array(RuleConditionSchema),
  actions: z.array(RuleActionSchema),
  priority: z.number(),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean().optional(),
  sourceText: z.string(),
});

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
  conversionId?: string;
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

const CLASSIFY_PROMPT = `You are a compensation policy analyst specializing in HR compensation structures.
Given a compensation policy document, classify it into sections by rule type.

Each section should be categorized as one of:
- MERIT: Base salary increases tied to performance, tenure, or market adjustments
- BONUS: Variable pay, incentive bonuses, spot bonuses, signing bonuses
- LTI: Long-term incentives, stock options, RSUs, performance shares
- PRORATION: Rules for partial-year employees, mid-cycle hires, transfers
- CAP: Maximum limits on increases, total compensation caps
- FLOOR: Minimum guaranteed increases, salary floors
- ELIGIBILITY: Who qualifies — tenure requirements, employment status, performance thresholds
- CUSTOM: Anything that doesn't fit the above categories

Return a JSON array of objects with:
- "category": the RuleType
- "text": the relevant policy text for that section
- "lineNumbers": optional [start, end] line numbers

## Example

Input: "All full-time employees with at least 6 months tenure are eligible for the annual merit cycle. Employees rated 4 or above receive 5-7% merit increase. Maximum total increase cannot exceed 15% of base salary. New hires within 90 days receive prorated increases."

Output:
[
  {"category": "ELIGIBILITY", "text": "All full-time employees with at least 6 months tenure are eligible for the annual merit cycle."},
  {"category": "MERIT", "text": "Employees rated 4 or above receive 5-7% merit increase."},
  {"category": "CAP", "text": "Maximum total increase cannot exceed 15% of base salary."},
  {"category": "PRORATION", "text": "New hires within 90 days receive prorated increases."}
]

Only return valid JSON. No markdown fences.`;

const EXTRACT_PROMPT = `You are a compensation rules extraction expert. Given classified policy sections,
extract specific rules with conditions, thresholds, and actions.

For each rule, extract:
- "name": short descriptive name (e.g., "High Performer Merit Increase")
- "description": what the rule does in plain English
- "ruleType": matching the section category
- "conditions": array of { "field": string, "operator": one of (eq|neq|gt|gte|lt|lte|in|notIn|between|contains|startsWith|matches), "value": any }
- "actions": array of { "type": one of (setMerit|setBonus|setLTI|applyMultiplier|applyFloor|applyCap|flag|block), "params": object }
- "priority": number (lower = higher priority, start at 10 and increment by 10)
- "confidence": 0-1 how confident you are in the extraction
- "sourceText": the original policy text this was extracted from

Common fields for conditions: department, level, title, location, baseSalary, performanceRating, hireDate, employeeCode, tenure, employmentType, jobFamily, compaRatio.

## Example

Input section: {"category": "MERIT", "text": "Employees rated 4 or above receive a 5% merit increase. Employees rated 5 (exceptional) receive 7%."}

Output:
[
  {
    "name": "High Performer Merit Increase",
    "description": "Employees with performance rating of 4 or above receive a 5% merit increase",
    "ruleType": "MERIT",
    "conditions": [{"field": "performanceRating", "operator": "gte", "value": 4}],
    "actions": [{"type": "setMerit", "params": {"percentage": 5}}],
    "priority": 20,
    "confidence": 0.95,
    "sourceText": "Employees rated 4 or above receive a 5% merit increase."
  },
  {
    "name": "Exceptional Performer Merit Increase",
    "description": "Employees with exceptional rating of 5 receive a 7% merit increase",
    "ruleType": "MERIT",
    "conditions": [{"field": "performanceRating", "operator": "eq", "value": 5}],
    "actions": [{"type": "setMerit", "params": {"percentage": 7}}],
    "priority": 10,
    "confidence": 0.95,
    "sourceText": "Employees rated 5 (exceptional) receive 7%."
  }
]

Only return valid JSON array. No markdown fences.`;

// ─────────────────────────────────────────────────────────────
// Node Factories (capture model via closure)
// ─────────────────────────────────────────────────────────────

/**
 * Helper to safely parse JSON from LLM output, stripping markdown fences if present.
 */
function safeParseLLMJson(content: string): unknown {
  let cleaned = content.trim();
  // Strip markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return JSON.parse(cleaned);
}

function createClassifySectionsNode(model: ChatOpenAI) {
  return async (state: PolicyParserStateType): Promise<{ sections: PolicySection[]; messages: BaseMessage[] }> => {
    const response = await model.invoke([
      new SystemMessage(CLASSIFY_PROMPT),
      new HumanMessage(state.policyText),
    ]);

    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    let sections: PolicySection[];
    try {
      const parsed = safeParseLLMJson(content);
      const validated = z.array(PolicySectionSchema).parse(parsed);
      sections = validated as PolicySection[];
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
      const parsed = safeParseLLMJson(content);
      const validated = z.array(ExtractedRuleSchema).parse(parsed);
      extractedRules = validated.map((r) => ({
        ...r,
        ruleType: r.ruleType as RuleType,
        conditions: r.conditions as RuleCondition[],
        actions: r.actions as RuleAction[],
        needsReview: r.needsReview ?? r.confidence < 0.7,
      }));
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

/**
 * Confidence calibration node — adjusts confidence scores based on
 * structural quality signals (completeness, specificity, consistency).
 */
function createCalibrateConfidenceNode() {
  return async (state: PolicyParserStateType): Promise<{ validatedRules: ExtractedRule[] }> => {
    const calibrated = state.validatedRules.map((rule) => {
      let confidence = rule.confidence;

      // Boost: rule has both conditions and actions (well-formed)
      if (rule.conditions.length > 0 && rule.actions.length > 0) {
        confidence = Math.min(1, confidence + 0.05);
      }

      // Penalize: empty conditions or actions
      if (rule.conditions.length === 0) {
        confidence = Math.min(confidence, 0.4);
      }
      if (rule.actions.length === 0) {
        confidence = Math.min(confidence, 0.4);
      }

      // Boost: has meaningful source text (>20 chars)
      if (rule.sourceText && rule.sourceText.length > 20) {
        confidence = Math.min(1, confidence + 0.03);
      }

      // Penalize: generic/vague names
      if (rule.name.length < 5 || rule.name.toLowerCase().startsWith('rule ')) {
        confidence = Math.min(confidence, 0.5);
      }

      // Boost: has description
      if (rule.description && rule.description.length > 10) {
        confidence = Math.min(1, confidence + 0.02);
      }

      // Penalize: conditions with empty values
      for (const cond of rule.conditions) {
        if (cond.value === '' || cond.value === null || cond.value === undefined) {
          confidence = Math.min(confidence, 0.3);
        }
      }

      // Clamp to [0, 1]
      confidence = Math.max(0, Math.min(1, confidence));

      return {
        ...rule,
        confidence,
        needsReview: confidence < 0.7,
      };
    });

    return { validatedRules: calibrated };
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
        calibrateConfidence: createCalibrateConfidenceNode(),
      },
      edges: [
        [START, 'classifySections'],
        ['classifySections', 'extractRules'],
        ['extractRules', 'mapToSchema'],
        ['mapToSchema', 'validateRules'],
        ['validateRules', 'calibrateConfidence'],
        ['calibrateConfidence', END],
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

