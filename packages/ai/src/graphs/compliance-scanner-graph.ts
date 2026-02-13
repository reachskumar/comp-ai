/**
 * Compliance Scanner Graph — multi-node LangGraph agent for AI audit & compliance scanning.
 *
 * Flow: START → scan_rules → scan_decisions → scan_data → assess_risk → generate_report → END
 *
 * Each node uses the LLM with domain tools to analyze a specific compliance area,
 * building up findings in the state. The final node produces an overall score and report.
 */

import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import {
  createComplianceTools,
  type ComplianceDbAdapter,
} from '../tools/compliance-tools.js';

// ─── State ────────────────────────────────────────────────

export interface ComplianceFinding {
  category: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  explanation: string;
  remediation: string;
  affectedScope: Record<string, unknown>;
}

const ComplianceScannerState = Annotation.Root({
  ...MessagesAnnotation.spec,
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  metadata: Annotation<Record<string, unknown>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  findings: Annotation<ComplianceFinding[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  overallScore: Annotation<number | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  aiReport: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  currentPhase: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => 'init',
  }),
});

type ScannerState = typeof ComplianceScannerState.State;

// ─── Types ────────────────────────────────────────────────

export interface ComplianceScannerInput {
  tenantId: string;
  userId: string;
  scanConfig?: Record<string, unknown>;
}

export interface ComplianceScannerOutput {
  tenantId: string;
  userId: string;
  findings: ComplianceFinding[];
  overallScore: number;
  aiReport: string;
}

// ─── System Prompts ───────────────────────────────────────

const SCAN_RULES_PROMPT = `You are a compensation compliance auditor. Analyze the tenant's compensation rules for compliance issues.

Check for:
1. FLSA overtime classification gaps — rules that don't properly handle exempt vs non-exempt
2. Missing eligibility rules — employees without applicable rules
3. Policy limit violations — rules with caps/floors that conflict
4. Regulatory requirement gaps — missing required rules for the jurisdiction

Use the get_all_rules tool to fetch rules, then analyze them.
Return your findings as a JSON array of objects with: category, severity (critical/warning/info), title, description, explanation, remediation, affectedScope.
Wrap the JSON in <findings>...</findings> tags.`;

const SCAN_DECISIONS_PROMPT = `You are a compensation compliance auditor. Analyze recent compensation decisions for compliance issues.

Check for:
1. Pay equity red flags — significant pay gaps by gender/ethnicity for similar roles
2. FLSA violations — overtime-eligible employees not receiving proper overtime
3. Inconsistent decision patterns — similar employees getting very different outcomes
4. Policy limit violations — decisions exceeding configured caps

Use the get_recent_decisions tool to fetch decisions, then analyze them.
Return your findings as a JSON array of objects with: category, severity (critical/warning/info), title, description, explanation, remediation, affectedScope.
Wrap the JSON in <findings>...</findings> tags.`;

const SCAN_DATA_PROMPT = `You are a compensation compliance auditor. Analyze compensation data statistics for compliance issues.

Check for:
1. Pay equity concerns — statistical disparities in pay by protected class
2. Benefits eligibility errors — employees who should be enrolled but aren't
3. Data quality issues — missing or inconsistent compensation data
4. Compa-ratio outliers — employees significantly above/below market

Use get_comp_data_stats and get_benefits_configs tools to fetch data, then analyze.
Return your findings as a JSON array of objects with: category, severity (critical/warning/info), title, description, explanation, remediation, affectedScope.
Wrap the JSON in <findings>...</findings> tags.`;

const ASSESS_RISK_PROMPT = `You are a compensation compliance risk assessor. Review all findings collected so far and:

1. Calculate an overall compliance score (0-100, where 100 = fully compliant)
2. Scoring: start at 100, deduct 15 per critical finding, 5 per warning, 1 per info
3. Minimum score is 0

Return ONLY a JSON object wrapped in <assessment>...</assessment> tags:
{"score": <number>, "riskLevel": "low|medium|high|critical"}`;

const GENERATE_REPORT_PROMPT = `You are a compensation compliance report writer. Generate a concise executive summary of the compliance audit.

Include:
1. Overall compliance score and risk level
2. Summary of critical findings (if any)
3. Top 3 recommended actions
4. Regulatory areas reviewed

Write in professional, clear language suitable for HR leadership and auditors.
Keep it under 500 words. Return the report as plain text.`;

// ─── Helpers ──────────────────────────────────────────────

function extractFindings(content: string): ComplianceFinding[] {
  const match = content.match(/<findings>([\s\S]*?)<\/findings>/);
  if (!match?.[1]) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractAssessment(content: string): { score: number; riskLevel: string } | null {
  const match = content.match(/<assessment>([\s\S]*?)<\/assessment>/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ─── Build Graph ──────────────────────────────────────────

export async function buildComplianceScannerGraph(
  db: ComplianceDbAdapter,
  tenantId: string,
  options: CreateGraphOptions = {},
) {
  const tools = createComplianceTools(tenantId, db);

  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'compliance-scanner'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature ?? 0.1,
    maxTokens: modelConfig.maxTokens ?? 4096,
  });

  const modelWithTools = model.bindTools(tools);
  const toolNode = new ToolNode(tools);

  async function toolExecutor(
    state: ScannerState,
  ): Promise<{ messages: BaseMessage[] }> {
    const result = await toolNode.invoke(state);
    const msgs = (result as { messages?: BaseMessage[] }).messages ?? [];
    return { messages: msgs };
  }

  function shouldContinueToTools(state: ScannerState): string {
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
    return 'next';
  }

  // ─── Node: scan_rules ─────────────────────────────────
  async function scanRules(state: ScannerState) {
    const response = await modelWithTools.invoke([
      new SystemMessage(SCAN_RULES_PROMPT),
      new HumanMessage('Scan all compensation rules for compliance issues.'),
      ...state.messages,
    ]);
    const content = typeof response.content === 'string' ? response.content : '';
    const findings = extractFindings(content);
    return {
      messages: [response],
      findings,
      currentPhase: 'scan_rules',
    };
  }

  // ─── Node: scan_decisions ─────────────────────────────
  async function scanDecisions(state: ScannerState) {
    const response = await modelWithTools.invoke([
      new SystemMessage(SCAN_DECISIONS_PROMPT),
      new HumanMessage('Scan recent compensation decisions for compliance issues.'),
      ...state.messages,
    ]);
    const content = typeof response.content === 'string' ? response.content : '';
    const findings = extractFindings(content);
    return {
      messages: [response],
      findings,
      currentPhase: 'scan_decisions',
    };
  }

  // ─── Node: scan_data ──────────────────────────────────
  async function scanData(state: ScannerState) {
    const response = await modelWithTools.invoke([
      new SystemMessage(SCAN_DATA_PROMPT),
      new HumanMessage('Scan compensation data and benefits for compliance issues.'),
      ...state.messages,
    ]);
    const content = typeof response.content === 'string' ? response.content : '';
    const findings = extractFindings(content);
    return {
      messages: [response],
      findings,
      currentPhase: 'scan_data',
    };
  }

  // ─── Node: assess_risk ────────────────────────────────
  async function assessRisk(state: ScannerState) {
    const findingsSummary = JSON.stringify(
      state.findings.map((f) => ({
        category: f.category,
        severity: f.severity,
        title: f.title,
      })),
    );
    const response = await model.invoke([
      new SystemMessage(ASSESS_RISK_PROMPT),
      new HumanMessage(
        `Here are the findings from the compliance scan:\n${findingsSummary}\n\nCalculate the overall compliance score.`,
      ),
    ]);
    const content = typeof response.content === 'string' ? response.content : '';
    const assessment = extractAssessment(content);
    const score = assessment?.score ?? Math.max(0, 100 - state.findings.filter(f => f.severity === 'critical').length * 15 - state.findings.filter(f => f.severity === 'warning').length * 5 - state.findings.filter(f => f.severity === 'info').length);
    return {
      messages: [response],
      overallScore: Math.max(0, Math.min(100, score)),
      currentPhase: 'assess_risk',
    };
  }

  // ─── Node: generate_report ────────────────────────────
  async function generateReport(state: ScannerState) {
    const findingsSummary = JSON.stringify(state.findings, null, 2);
    const response = await model.invoke([
      new SystemMessage(GENERATE_REPORT_PROMPT),
      new HumanMessage(
        `Compliance Score: ${state.overallScore}/100\n\nFindings:\n${findingsSummary}\n\nGenerate the executive summary report.`,
      ),
    ]);
    const report = typeof response.content === 'string' ? response.content : '';
    return {
      messages: [response],
      aiReport: report,
      currentPhase: 'generate_report',
    };
  }

  return createAgentGraph(
    {
      name: 'compliance-scanner-graph',
      graphType: 'compliance-scanner',
      stateSchema: ComplianceScannerState,
      nodes: {
        scan_rules: scanRules,
        scan_decisions: scanDecisions,
        scan_data: scanData,
        assess_risk: assessRisk,
        generate_report: generateReport,
        tools: toolExecutor,
      },
      edges: [
        [START, 'scan_rules'],
        ['scan_rules', 'scan_decisions'],
        ['scan_decisions', 'scan_data'],
        ['scan_data', 'assess_risk'],
        ['assess_risk', 'generate_report'],
        ['generate_report', END],
        ['tools', 'scan_rules'],
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Convenience function to invoke the compliance scanner graph.
 */
export async function invokeComplianceScannerGraph(
  input: ComplianceScannerInput,
  db: ComplianceDbAdapter,
  options: CreateGraphOptions = {},
): Promise<ComplianceScannerOutput> {
  const { graph } = await buildComplianceScannerGraph(db, input.tenantId, options);

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [new HumanMessage('Run a full compliance audit scan.')],
    metadata: input.scanConfig ?? {},
    findings: [],
    overallScore: null,
    aiReport: null,
    currentPhase: 'init',
  });

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    findings: (result.findings as ComplianceFinding[]) ?? [],
    overallScore: (result.overallScore as number) ?? 0,
    aiReport: (result.aiReport as string) ?? '',
  };
}

