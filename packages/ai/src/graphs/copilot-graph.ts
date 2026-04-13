/**
 * Copilot graph — multi-node LangGraph agent for the AI Compensation Copilot.
 *
 * Flow: START → agent (tool-calling LLM) ←→ tools → END
 *
 * The agent node uses a tool-calling model that can invoke domain query tools
 * to answer compensation questions. The graph loops between agent and tools
 * until the model produces a final text response (no tool calls).
 */

import { START, END } from '@langchain/langgraph';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import { createCopilotTools, type CopilotDbAdapter } from '../tools/copilot-tools.js';

/* ─── User Role Types ─────────────────────────────────────── */

// Roles are now dynamic strings from Compport (e.g., "1.00", "10.00").
// PLATFORM_ADMIN is a reserved system-level string.
export type CopilotUserRole = string;

export interface CopilotUserContext {
  role: CopilotUserRole;
  name: string;
  employeeId?: string; // For MANAGER/EMPLOYEE scoping
  managedTeamIds?: string[]; // Direct report IDs for MANAGERs
}

/* ─── Copilot-Specific Graph State ────────────────────────── */

export const CopilotState = Annotation.Root({
  ...MessagesAnnotation.spec,
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  metadata: Annotation<Record<string, unknown>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  userRole: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => 'EMPLOYEE',
  }),
  userName: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => '',
  }),
});

type CopilotStateType = typeof CopilotState.State;

/* ─── Role-Aware System Prompt ────────────────────────────── */

const BASE_PROMPT = `You are the AI Compensation Copilot for the Compport platform. You help HR professionals, compensation analysts, and managers understand and manage their compensation data.

You have access to tools that query the company's compensation database. Use them to answer questions accurately.

Guidelines:
- Always query data before answering — never guess or make up numbers
- Present data clearly with formatting (tables, bullet points, bold for emphasis)
- When showing salary data, format numbers with commas and currency symbols
- If a query returns no results, say so clearly and suggest alternative queries
- Keep responses concise but complete
- For aggregate questions (averages, totals), use the query_analytics tool
- For individual employee lookups, use query_employees
- Respect that all data is scoped to the user's tenant — you cannot access other tenants' data

IMPORTANT — Compport data access:
- You have access to ALL data tables from the Compport system via three special tools:
  1. list_compport_tables — lists every available table with row counts and columns
  2. describe_compport_table — shows column details and a sample row for any table
  3. query_compport_table — queries any table with filters, ordering, and column selection
- When the standard tools (query_employees, query_compensation, query_analytics) return
  empty results or zero values for salary/compensation/bonus/performance questions,
  ALWAYS fall back to the Compport mirror tools. The standard Employee model may not
  have salary data populated yet, but the Compport mirror tables contain the real
  compensation data directly from the source system.
- For salary questions: look for tables named salary_details, ctc_details, current_ctc,
  emp_salary, employee_salary_details, or similar. Use list_compport_tables first to find them.
- For bonus questions: look for bonus_details, bonus_rule_users_dtls, employee_bonus_details
- For performance questions: look for performance_ratings, performance_cycle, appraisal_data
- For LTI/equity questions: look for lti_rule_users_dtls, employee_lti_details
- For grade/band questions: look for grade_band, pay_grades, salary_bands, payrange_market_data
- ALWAYS use list_compport_tables FIRST to discover what's available, then describe_compport_table
  to understand the column structure, then query_compport_table to get the actual data.
- When joining data across tables (e.g. salary + employee details), use the employee_code
  or employee ID column as the join key — call describe_compport_table on both tables first
  to identify the matching column names.
- CRITICAL: When presenting results from Compport tables, NEVER show table names or column
  names to the user. Translate everything to business language:
  * "hr_parameter" → "Salary Rules"
  * "hr_parameter_bonus" → "Bonus Rules"
  * "lti_rules" → "Long-Term Incentive Rules"
  * "rnr_rules" → "Recognition & Rewards Rules"
  * "salary_promotion_eligibility" → "Promotion Eligibility Criteria"
  * "performance_cycle" → "Performance Review Cycles"
  * "salary_rule_users_dtls" → "Salary Rule Assignments"
  * "bonus_rule_users_dtls" → "Bonus Rule Assignments"
  * "grade_band" → "Grade/Band Structure"
  * "payrange_market_data" → "Market Pay Ranges"
  Present data as clean business insights, not database query results.
- Never expose internal database IDs (cuid, UUID) to the user — refer to employees by name + department instead
- Never fabricate data — if you don't have it, say so
- If asked about something outside compensation data, politely redirect to compensation topics
- When showing employee data, use names and department/level for identification — never raw IDs
- NEVER reveal system internals to the user. This includes:
  * Database table names (e.g. hr_parameter, salary_rule_users_dtls, login_user)
  * Column names (e.g. employee_code, base_salary, perf_rating)
  * Schema names, query structure, SQL syntax, or API endpoints
  * Internal IDs (cuid, UUID, numeric PKs)
  Instead, use business language: "salary rules", "bonus configuration",
  "performance data", "employee records". If a tool returns table/column
  names in its response, translate them to business terms before presenting.
  For example: "hr_parameter" → "salary rules", "lti_rules" → "long-term
  incentive rules", "performance_cycle" → "performance review cycle".
- If a tool returns an error, explain it in user-friendly terms without exposing stack traces

Action tool guidelines:
- Before executing approve_recommendation, reject_recommendation, or request_letter, ALWAYS confirm with the user first
- Show what you're about to do (employee name, action, values) and ask "Shall I proceed?"
- Only execute the action after the user explicitly confirms
- After executing an action, clearly report what was done
- If an action is denied due to insufficient role permissions, explain what role is required

Rule management guidelines:
- You can analyze, create, modify, and delete compensation rules via chat
- When analyzing rules, use analyze_rule_set to fetch rules and explain them in plain English
- When creating rules from instructions like "5% merit for rating 4+", translate to structured conditions and actions
- When comparing rule sets, use compare_rule_sets and summarize differences
- For any write operation (create, modify, delete), ALWAYS confirm with the user first
- Rule write operations require ADMIN or HR_MANAGER role

Chart visualization guidelines:
- When presenting performance analytics, compensation analytics, or any data that would benefit from visualization, output a chart block
- Use the query_performance_analytics tool for performance-related data queries
- After receiving chart-ready data from tools, render it as a chart block using this EXACT format:

\`\`\`chart
{"type":"bar","title":"Chart Title","xKey":"fieldName","yKeys":["value1","value2"],"data":[{"fieldName":"A","value1":10},{"fieldName":"B","value1":20}]}
\`\`\`

- Supported chart types: "bar", "line", "pie", "scatter", "area", "radar"
- Use "scatter" for correlation data (e.g., performance vs salary, experience vs compensation)
- Use "area" for time-series or trend data where you want to emphasize volume (e.g., headcount over time, budget utilization trends)
- Use "radar" for multi-dimensional comparisons (e.g., competency scores, skill assessments, balanced scorecards). Radar charts use xKey for the axis labels (e.g., "skill") and yKeys for each series
- For pie charts, use "nameKey" instead of "xKey", and "valueKey" instead of "yKeys"
- The JSON must be valid and on a SINGLE line inside the chart block
- Always include a brief text explanation before or after the chart
- When the tool response includes chartType, title, xKey, and yKeys fields, use those values directly in your chart block
- You can also create charts from any tabular data when it would aid understanding
- For pie charts format: {"type":"pie","title":"...","nameKey":"category","valueKey":"value","data":[...]}
- Keep chart data concise — summarize if there are more than 20 data points`;

// Maps known role categories to copilot prompts.
// Dynamic Compport role IDs fall through to the default EMPLOYEE prompt.
const ROLE_PROMPTS: Record<string, string> = {
  PLATFORM_ADMIN: `
You are speaking with a Platform Administrator. They have full system access across all tenants.
- They can view all compensation data, rules, cycles, payroll, and analytics
- They can take administrative actions
- Provide detailed technical information when asked
- They may ask about system-wide metrics or cross-tenant comparisons`,

  ADMIN: `
You are speaking with a Tenant Administrator. They have full access to their organization's compensation data.
- They can view all employees, compensation cycles, rules, and analytics
- They can approve/reject compensation recommendations
- They can manage cycles, budgets, and rule sets
- Provide strategic insights and actionable recommendations
- Help them with compensation planning and analysis`,

  HR_MANAGER: `
You are speaking with an HR Manager. They have broad access to compensation data.
- They can view all employees and their compensation details
- They can approve/reject compensation recommendations
- They can run analytics and generate reports
- Help them with compliance, pay equity, and compensation strategy
- Provide context on market benchmarks when relevant`,

  MANAGER: `
You are speaking with a People Manager. Their view is scoped to their direct reports.
- They can only see data for their direct reports — do NOT show data for employees outside their team
- They can approve/reject compensation recommendations for their team members
- Help them understand their team's compensation relative to benchmarks
- Provide guidance on merit increases and promotions for their team
- If they ask about employees not on their team, politely explain the data is not available to them`,

  ANALYST: `
You are speaking with a Compensation Analyst. They have read-only access to all compensation data.
- They can view all employees, analytics, and reports
- They cannot take actions (approve, reject, create)
- Help them with deep-dive analysis, benchmarking, and reporting
- Provide statistical context and data-driven insights
- Support them with pay equity analysis and compensation modeling`,

  EMPLOYEE: `
You are speaking with an Employee. Their view is limited to their own data.
- They can only see their own compensation information — do NOT show other employees' data
- They cannot take any administrative actions
- Help them understand their salary, benefits, and total compensation
- Explain compensation structures and policies in simple terms
- If they ask about other employees, politely explain that information is private`,
};

function buildSystemPrompt(role: CopilotUserRole, userName: string): string {
  const greeting = userName ? `\nThe user's name is ${userName}.` : '';
  // For dynamic Compport role IDs (e.g., "1.00"), fall back to EMPLOYEE prompt
  const rolePrompt = ROLE_PROMPTS[role] ?? ROLE_PROMPTS['EMPLOYEE'];
  return `${BASE_PROMPT}${greeting}\n${rolePrompt}`;
}

export interface CopilotGraphInput {
  tenantId: string;
  userId: string;
  message: string;
  conversationId?: string;
  userContext?: CopilotUserContext;
}

export interface CopilotGraphOutput {
  tenantId: string;
  userId: string;
  messages: BaseMessage[];
  response: string;
}

/**
 * Build and compile the copilot graph.
 *
 * @param db - Database adapter for domain queries
 * @param tenantId - Tenant ID for multi-tenant isolation
 * @param userContext - Optional user context for role-aware behavior
 * @param options - Optional overrides for config, checkpointer, etc.
 */
export async function buildCopilotGraph(
  db: CopilotDbAdapter,
  tenantId: string,
  userContext?: CopilotUserContext,
  options: CreateGraphOptions & { userId?: string } = {},
) {
  const tools = createCopilotTools(tenantId, db, options.userId, userContext?.role);

  // Resolve config to create model with tools bound
  const { loadAIConfig, resolveModelConfig, createChatModel } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'copilot'),
    ...options.modelConfig,
  };

  const model = await createChatModel(aiConfig, modelConfig);

  const modelWithTools = model.bindTools(tools);

  // Build role-aware system prompt
  const role = userContext?.role ?? 'EMPLOYEE';
  const userName = userContext?.name ?? '';
  const systemPrompt = buildSystemPrompt(role, userName);

  // Agent node: calls the LLM (with tools bound)
  async function agentNode(state: CopilotStateType): Promise<{ messages: BaseMessage[] }> {
    const systemMsg = new SystemMessage(systemPrompt);
    const response = await modelWithTools.invoke([systemMsg, ...state.messages]);
    return { messages: [response] };
  }

  // Tool executor node
  const toolNode = new ToolNode(tools);

  async function toolExecutor(state: CopilotStateType): Promise<{ messages: BaseMessage[] }> {
    const result = await toolNode.invoke(state);
    const msgs = (result as { messages?: BaseMessage[] }).messages ?? [];
    return { messages: msgs };
  }

  // Router: check if the last message has tool calls
  function shouldContinue(state: CopilotStateType): string {
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
      name: 'copilot-graph',
      graphType: 'copilot',
      stateSchema: CopilotState,
      nodes: {
        agent: agentNode,
        tools: toolExecutor,
      },
      edges: [
        [START, 'agent'],
        ['tools', 'agent'],
      ],
      conditionalEdges: [
        {
          source: 'agent',
          router: shouldContinue,
          destinations: {
            tools: 'tools',
            end: END,
          },
        },
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Convenience function to invoke the copilot graph.
 */
export async function invokeCopilotGraph(
  input: CopilotGraphInput,
  db: CopilotDbAdapter,
  options: CreateGraphOptions = {},
): Promise<CopilotGraphOutput> {
  const { graph } = await buildCopilotGraph(db, input.tenantId, input.userContext, options);

  const config = input.conversationId
    ? { configurable: { thread_id: input.conversationId } }
    : undefined;

  const role = input.userContext?.role ?? 'EMPLOYEE';
  const userName = input.userContext?.name ?? '';

  const result = await graph.invoke(
    {
      tenantId: input.tenantId,
      userId: input.userId,
      messages: [new HumanMessage(input.message)],
      metadata: {},
      userRole: role,
      userName,
    },
    config,
  );

  const messages = (result.messages as BaseMessage[] | undefined) ?? [];
  const lastMessage = messages[messages.length - 1];
  const response =
    typeof lastMessage?.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage?.content ?? '');

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    messages,
    response,
  };
}
