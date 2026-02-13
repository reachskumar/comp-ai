/**
 * Data Quality graph — multi-node LangGraph agent for AI-powered data quality analysis.
 *
 * Flow: START → agent ←→ tools → END
 *
 * Overlays GPT-4o intelligence on the existing data hygiene engine to provide
 * smart fix suggestions, natural language issue explanations, and quality reports.
 */

import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import { createDataQualityTools, type DataQualityDbAdapter } from '../tools/data-quality-tools.js';

// ─── State ──────────────────────────────────────────────────

export const DataQualityState = Annotation.Root({
  ...MessagesAnnotation.spec,
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  importJobId: Annotation<string>,
  metadata: Annotation<Record<string, unknown>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
});

export type DataQualityStateType = typeof DataQualityState.State;

// ─── System Prompt ──────────────────────────────────────────

const SYSTEM_PROMPT = `You are the AI Data Quality Agent for the Compport compensation platform. You analyze imported CSV data files to identify quality issues, explain them in plain English, and suggest fixes.

You have access to tools that query import job data, issues, sample rows, field statistics, and historical imports.

Your analysis flow:
1. CLASSIFY: Retrieve and categorize all detected issues by severity and type
2. SUGGEST FIXES: For each issue, propose a specific fix with before/after values
3. EXPLAIN: Write plain-English explanations for why each issue matters
4. REPORT: Generate an overall quality score (0-100) and narrative summary

Guidelines:
- Always use tools to fetch real data — never guess or fabricate
- Explain issues in business terms HR professionals understand
- Provide confidence scores (0-1) for each suggested fix
- Group related issues together (e.g., all date format issues)
- Compare against historical imports when available to identify recurring patterns
- Be specific: "Row 5, Column 'hire_date': '13/25/2024' is not a valid date" not "some dates are wrong"
- Quality score formula: 100 - (errors * 5) - (warnings * 1), minimum 0

Output your final report as a JSON object with this structure:
{
  "qualityScore": number,
  "summary": "narrative summary string",
  "issueGroups": [{ "groupName": "string", "issueType": "string", "severity": "ERROR|WARNING|INFO", "count": number, "explanation": "plain English explanation", "suggestedFixes": [{ "row": number, "column": "string", "originalValue": "string", "suggestedValue": "string", "confidence": number, "explanation": "string" }] }],
  "bulkFixes": [{ "description": "string", "affectedRows": number, "fixType": "string" }],
  "recommendations": ["string"]
}`;

// ─── Input / Output Types ───────────────────────────────────

export interface DataQualityGraphInput {
  tenantId: string;
  userId: string;
  importJobId: string;
}

export interface DataQualityIssueFixSuggestion {
  row: number;
  column: string;
  originalValue: string;
  suggestedValue: string;
  confidence: number;
  explanation: string;
}

export interface DataQualityIssueGroup {
  groupName: string;
  issueType: string;
  severity: string;
  count: number;
  explanation: string;
  suggestedFixes: DataQualityIssueFixSuggestion[];
}

export interface DataQualityBulkFix {
  description: string;
  affectedRows: number;
  fixType: string;
}

export interface DataQualityReport {
  qualityScore: number;
  summary: string;
  issueGroups: DataQualityIssueGroup[];
  bulkFixes: DataQualityBulkFix[];
  recommendations: string[];
}

export interface DataQualityGraphOutput {
  tenantId: string;
  userId: string;
  importJobId: string;
  messages: BaseMessage[];
  report: DataQualityReport | null;
  rawResponse: string;
}


// ─── Graph Builder ──────────────────────────────────────────

/**
 * Build and compile the data quality graph.
 */
export async function buildDataQualityGraph(
  db: DataQualityDbAdapter,
  tenantId: string,
  options: CreateGraphOptions = {},
) {
  const tools = createDataQualityTools(tenantId, db);

  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'data-quality'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.maxTokens,
  });

  const modelWithTools = model.bindTools(tools);

  async function agentNode(
    state: DataQualityStateType,
  ): Promise<{ messages: BaseMessage[] }> {
    const systemMsg = new SystemMessage(SYSTEM_PROMPT);
    const response = await modelWithTools.invoke([systemMsg, ...state.messages]);
    return { messages: [response] };
  }

  const toolNode = new ToolNode(tools);

  async function toolExecutor(
    state: DataQualityStateType,
  ): Promise<{ messages: BaseMessage[] }> {
    const result = await toolNode.invoke(state);
    const msgs = (result as { messages?: BaseMessage[] }).messages ?? [];
    return { messages: msgs };
  }

  function shouldContinue(state: DataQualityStateType): string {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage &&
      'tool_calls' in lastMessage &&
      Array.isArray((lastMessage as AIMessage).tool_calls) &&
      (lastMessage as AIMessage).tool_calls!.length > 0
    ) {
      return 'tools';
    }
    return 'end';
  }

  return createAgentGraph(
    {
      name: 'data-quality-graph',
      graphType: 'data-quality',
      stateSchema: DataQualityState,
      nodes: { agent: agentNode, tools: toolExecutor },
      edges: [[START, 'agent'], ['tools', 'agent']],
      conditionalEdges: [{
        source: 'agent',
        router: shouldContinue,
        destinations: { tools: 'tools', end: END },
      }],
    },
    { ...options, config: aiConfig },
  );
}

function parseReport(response: string): DataQualityReport | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response];
    const jsonStr = jsonMatch[1]?.trim() ?? response;
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.qualityScore === 'number') {
      return parsed as DataQualityReport;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Convenience function to invoke the data quality graph.
 */
export async function invokeDataQualityGraph(
  input: DataQualityGraphInput,
  db: DataQualityDbAdapter,
  options: CreateGraphOptions = {},
): Promise<DataQualityGraphOutput> {
  const { graph } = await buildDataQualityGraph(db, input.tenantId, options);

  const userMessage = `Analyze import job ${input.importJobId} for data quality issues. Use the tools to: 1) Get all import issues for this job 2) Get sample data rows to understand the data 3) Get field statistics to identify patterns 4) Check historical imports for recurring issues. Then produce a comprehensive quality report with explanations and fix suggestions.`;

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    importJobId: input.importJobId,
    messages: [new HumanMessage(userMessage)],
    metadata: {},
  });

  const messages = (result.messages as BaseMessage[] | undefined) ?? [];
  const lastMessage = messages[messages.length - 1];
  const rawResponse =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    importJobId: input.importJobId,
    messages,
    report: parseReport(rawResponse),
    rawResponse,
  };
}
