/**
 * Rule Analysis graph — a LangGraph agent specialised in analysing,
 * explaining, and generating compensation rules via LLM.
 *
 * Flow: START → agent (tool-calling LLM) ←→ tools → END
 *
 * Unlike the deterministic RuleGeneratorService, this graph uses an LLM to:
 * 1. Explain rules in plain English
 * 2. Generate rules from natural language instructions
 * 3. Compare rule sets and summarise differences
 */

import { START, END } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';
import {
  createRuleManagementTools,
  type RuleManagementDbAdapter,
} from '../tools/rule-management-tools.js';

/* ─── State ──────────────────────────────────────────────────── */

export const RuleAnalysisState = Annotation.Root({
  ...MessagesAnnotation.spec,
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  metadata: Annotation<Record<string, unknown>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
});

type RuleAnalysisStateType = typeof RuleAnalysisState.State;

/* ─── System Prompt ──────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are an expert Compensation Rule Analyst AI.

Your capabilities:
1. **Analyse rules** — Fetch rule sets and explain every rule in plain English, including what employees are affected, what compensation actions are taken, and in what priority order.
2. **Generate rules** — Create new compensation rules from natural language instructions. Convert phrases like "5% merit for employees rated 4 or above with compa-ratio below 0.9" into structured rule JSON.
3. **Compare rule sets** — Fetch two rule sets and produce a clear diff: what changed, what was added/removed, impact on budgets.
4. **Create / modify / delete rules** — Execute CRUD operations on rule sets and rules when the user asks.

Rule structure reference:
- **conditions**: array of { field, operator, value } objects. Fields include: performanceRating, compaRatio, tenure, department, level, location, salaryGrade.
- **actions**: array of { type, params } objects. Types include: setMerit (params: { percentage }), setBonus (params: { percentage | amount }), setLTI, setCap, setFloor, setEligibility.
- **ruleType**: MERIT, BONUS, LTI, PRORATION, CAP, FLOOR, ELIGIBILITY, CUSTOM
- **priority**: lower number = evaluated first

Guidelines:
- When analysing, provide a numbered list explaining each rule in business terms
- When generating, show the user the proposed rules in readable form and ask for confirmation before creating
- When comparing, highlight: added rules, removed rules, changed conditions/actions, net budget impact
- Always query the database before answering — never guess rule contents
- Format monetary values with commas and currency symbols
- Never expose internal IDs — use rule names and types instead
- For write operations, always confirm with the user first`;

/* ─── Input / Output ─────────────────────────────────────────── */

export interface RuleAnalysisInput {
  tenantId: string;
  userId: string;
  message: string;
  conversationId?: string;
  userRole?: string;
}

export interface RuleAnalysisOutput {
  tenantId: string;
  userId: string;
  messages: BaseMessage[];
  response: string;
}

/* ─── Build Graph ────────────────────────────────────────────── */

export async function buildRuleAnalysisGraph(
  db: RuleManagementDbAdapter,
  tenantId: string,
  userId?: string,
  userRole?: string,
  options: CreateGraphOptions = {},
) {
  const tools = createRuleManagementTools(tenantId, db, userId, userRole);

  const { loadAIConfig, resolveModelConfig, createChatModel } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'rule-analysis'),
    ...options.modelConfig,
  };

  const model = await createChatModel(aiConfig, modelConfig);
  const modelWithTools = model.bindTools(tools);

  async function agentNode(state: RuleAnalysisStateType): Promise<{ messages: BaseMessage[] }> {
    const systemMsg = new SystemMessage(SYSTEM_PROMPT);
    const response = await modelWithTools.invoke([systemMsg, ...state.messages]);
    return { messages: [response] };
  }

  const toolNode = new ToolNode(tools);

  async function toolExecutor(state: RuleAnalysisStateType): Promise<{ messages: BaseMessage[] }> {
    const result = await toolNode.invoke(state);
    const msgs = (result as { messages?: BaseMessage[] }).messages ?? [];
    return { messages: msgs };
  }

  function shouldContinue(state: RuleAnalysisStateType): string {
    const last = state.messages[state.messages.length - 1];
    if (
      last &&
      'tool_calls' in last &&
      Array.isArray((last as AIMessage).tool_calls) &&
      (last as AIMessage).tool_calls!.length > 0
    ) {
      return 'tools';
    }
    return 'end';
  }

  return createAgentGraph(
    {
      name: 'rule-analysis-graph',
      graphType: 'rule-analysis',
      stateSchema: RuleAnalysisState,
      nodes: { agent: agentNode, tools: toolExecutor },
      edges: [
        [START, 'agent'],
        ['tools', 'agent'],
      ],
      conditionalEdges: [
        {
          source: 'agent',
          router: shouldContinue,
          destinations: { tools: 'tools', end: END },
        },
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Convenience function to invoke the rule analysis graph.
 */
export async function invokeRuleAnalysisGraph(
  input: RuleAnalysisInput,
  db: RuleManagementDbAdapter,
  options: CreateGraphOptions = {},
): Promise<RuleAnalysisOutput> {
  const { graph } = await buildRuleAnalysisGraph(
    db,
    input.tenantId,
    input.userId,
    input.userRole,
    options,
  );

  const config = input.conversationId
    ? { configurable: { thread_id: input.conversationId } }
    : undefined;

  const result = await graph.invoke(
    {
      tenantId: input.tenantId,
      userId: input.userId,
      messages: [new HumanMessage(input.message)],
      metadata: {},
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
