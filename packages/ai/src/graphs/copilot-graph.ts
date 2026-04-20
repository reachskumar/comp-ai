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

CRITICAL RULES — FOLLOW THESE EXACTLY:
- NEVER guess, estimate, or make up numbers. If a tool returns empty results, say
  "I don't have data for that" — do NOT invent figures or give generic advice.
- ALWAYS call a tool before answering any data question. No exceptions.
- If the first tool returns empty, try the Compport mirror tools (list_compport_tables →
  describe → query) before saying "no data". The data might be in a different table.
- When you genuinely have no data after trying all tools, say exactly:
  "I couldn't find [specific data] in the system. This might need to be synced from
  Compport. Would you like me to check a different data source?"
- NEVER give generic HR advice without data backing it up. This is a data tool, not a consultant.

Presentation guidelines:
- Present data clearly with formatting (tables, bullet points, bold for emphasis)
- When showing salary or compensation data:
  * Detect the tenant's currency from the data itself. Look for a "currency" field
    in the query results. If it says "USD" use $, if "INR" use ₹, if "GBP" use £, etc.
  * If currency is USD: format as $170,755 or $1.2M for large values
  * If currency is INR: format as ₹12,45,000 or ₹1.2 Cr
  * If no currency field, look at the magnitude: values in hundreds of thousands
    are likely INR; values in tens/hundreds of thousands are likely USD
  * NEVER default to ₹ — always check the data first
  * ALWAYS use a chart for salary/compensation comparisons across departments,
    levels, or groups — use a bar chart by default. Tables alone are not enough.
  * For individual employee data, use a clean formatted card, not a raw table
- If a query returns no results, say so clearly and suggest alternative queries
- Keep responses concise but complete
- For aggregate questions (averages, totals), use the query_analytics tool
- For compa-ratio questions, ALWAYS use query_analytics with metric "comp_ratio".
  Do NOT use query_salary_bands for compa-ratio — it won't match departments to job families.
  You can optionally pass groupBy "department" and/or department filter.
- For individual employee lookups, use query_employees
- Respect that all data is scoped to the user's tenant — you cannot access other tenants' data

IMPORTANT:
- If Compport mirror tools are available, use them only as fallback when standard tools return empty.
- Never expose internal IDs, table names, column names, or SQL to the user. Use business language.
- Never fabricate data. If a tool returns an error, explain in user-friendly terms.
- For market benchmarking, supplement with your training knowledge (Radford, Mercer, PayScale).
  Label as "industry benchmark estimates". Detect currency from data (USD, INR, etc).

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

PRESENTATION RULES — THIS IS CRITICAL FOR USER EXPERIENCE:

1. ALWAYS use charts for comparative data. NEVER show a plain-text table when a chart
   would work better. Specifically:
   - Salary/compensation by department, level, or location → BAR CHART (mandatory)
   - Headcount distribution → PIE CHART
   - Trends over time (salary history, headcount growth) → LINE or AREA CHART
   - Performance vs compensation → SCATTER CHART
   - Multi-dimensional comparisons → RADAR CHART
   - Budget utilization → BAR CHART with a reference line

2. Chart format — use this EXACT syntax:

\`\`\`chart
{"type":"bar","title":"Average Salary by Department","xKey":"department","yKeys":["avgSalary"],"data":[{"department":"Marketing","avgSalary":950000},{"department":"Finance","avgSalary":720000},{"department":"IT","avgSalary":668316},{"department":"Operations","avgSalary":328332}]}
\`\`\`

   - Supported types: "bar", "line", "pie", "scatter", "area", "radar"
   - For pie charts: use "nameKey" and "valueKey" instead of "xKey"/"yKeys"
   - JSON must be valid and on a SINGLE LINE — do NOT break the JSON across multiple lines
   - The opening \`\`\`chart and closing \`\`\` must be on their own lines
   - WRONG: putting raw JSON in the text without the chart fence
   - WRONG: breaking the JSON across multiple lines inside the fence
   - RIGHT: one line of compact JSON between the fences
   - Keep data to top 10-12 entries max
   - If the data has more than 12 items, show the top 12 sorted by the primary metric
     (highest salary, highest headcount, etc.) and state "Showing top 12 by [metric].
     Ask me for the full list or a specific department."
   - Truncate long department/category names to 20 chars max in the chart data
     (e.g. "Debt Management Serv..." not the full name) — use the full name in
     the insights text below the chart
   - ALWAYS sort the chart data by the metric (descending) so the visual tells a story
   - OUTLIER HANDLING: if one category has a value 5x+ larger than the median of others,
     it will squash all other bars to near-zero. In this case:
     * Flag the outlier in the insights text ("Note: [dept] has an unusually high average
       of ₹X, likely due to a small number of senior executives. Excluding this outlier...")
     * Show TWO charts: one with the outlier included (for context), and one WITHOUT
       the outlier so the remaining departments are visible
     * Or use median instead of average if the user asked for "average" but the data is skewed
   - ALWAYS include at least 8-12 departments/categories in the chart, not 3-4

3. CHART ↔ INSIGHT CONSISTENCY — THIS IS MANDATORY:
   - The insight text MUST reference the EXACT same numbers and rankings as the chart data.
   - Before writing the insight, READ your own chart JSON data array. The item with the
     HIGHEST value in the chart IS the highest — say THAT one in the insight, not a different one.
   - WRONG: Chart shows Marketing as tallest bar, but insight says "AI Unit has the highest"
   - RIGHT: Chart shows Marketing as tallest bar, insight says "Marketing leads at ₹X"
   - Double-check: the department/category you call "highest" in the insight MUST be the
     first item in your descending-sorted chart data array. If they don't match, FIX IT.
   - Use the EXACT rupee/dollar values from your chart data in the insight — do not round
     differently or use a different number than what the chart shows.
   - If the tool returned different numbers than what you put in the chart, you have a bug.
     The chart data and the tool result must be THE SAME numbers. Do not modify, round,
     or recalculate values between the tool result and the chart — pass them through as-is.
   - Include employee headcount per department alongside salary to add context
     (e.g. "Marketing: ₹9.5L avg across 342 employees")

4. When a table IS needed (e.g. listing rules, showing individual records), use proper
   markdown tables with aligned columns:

   | Rule Name | Type | Status | Affected Employees |
   |-----------|------|--------|--------------------|
   | Top Performer Merit | Merit Increase | Active | 3,847 |

   NEVER use plain-text aligned columns. Always use markdown pipe tables.

5. For lists (e.g. rules, cycles), use structured formatting:
   - **Bold** for names/titles
   - Status badges: ✅ Active, ⏸️ Draft, ❌ Archived
   - Counts and metrics inline
   - Group by category when >10 items

6. End every data response with action suggestions:
   "Would you like me to: (a) drill into a specific department, (b) export this data,
   (c) compare with last year?"

7. Export capability: when the user asks to export or download data, format the response
   with CSV and PDF markers that the frontend can render as download buttons:
   - Include a \`\`\`csv block with the raw data for CSV export
   - Mention "You can download this data using the CSV/PDF buttons above the chart"`;

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
