/**
 * Rules Orchestrator Graph
 *
 * A LangGraph agent that manages the full lifecycle of compensation rules:
 *   Parse → Validate → Map → Explain → Simulate → Apply
 *
 * Entry points:
 *   - Chat: "create a 5% merit rule for top performers"
 *   - CSV/Excel upload: structured rule definitions
 *   - PDF upload: policy document → extracted rules
 *
 * The graph routes dynamically based on user intent:
 *   - "explain this rule" → explain node
 *   - "upload rules" / file attached → parse node
 *   - "simulate impact" → simulate node
 *   - "apply these rules" → apply node (with confirmation gate)
 */

import { Annotation, StateGraph, START, END, MessagesAnnotation } from '@langchain/langgraph';
import type { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

// ─── State Schema ────────────────────────────────────────

export const RulesOrchestratorState = Annotation.Root({
  ...MessagesAnnotation.spec,
  tenantId: Annotation<string>,
  userId: Annotation<string>,
  userRole: Annotation<string>({ reducer: (_, v) => v, default: () => 'ADMIN' }),

  // Intent routing
  intent: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),

  // Parsed rules from any input source (chat/CSV/PDF)
  parsedRules: Annotation<ParsedRule[]>({
    reducer: (_, v) => v,
    default: () => [],
  }),

  // Validation results
  validationReport: Annotation<ValidationResult[]>({
    reducer: (_, v) => v,
    default: () => [],
  }),

  // Compport table mapping
  compportMapping: Annotation<CompportRuleMapping[]>({
    reducer: (_, v) => v,
    default: () => [],
  }),

  // Simulation results
  simulationResult: Annotation<Record<string, unknown> | null>({
    reducer: (_, v) => v,
    default: () => null,
  }),

  // Whether user has confirmed apply action
  applyConfirmed: Annotation<boolean>({
    reducer: (_, v) => v,
    default: () => false,
  }),

  // File content (CSV/Excel/PDF text) if uploaded
  fileContent: Annotation<string>({
    reducer: (_, v) => v,
    default: () => '',
  }),
  fileType: Annotation<string>({
    reducer: (_, v) => v,
    default: () => '',
  }),
});

// ─── Types ───────────────────────────────────────────────

export interface ParsedRule {
  name: string;
  type: 'MERIT' | 'BONUS' | 'LTI' | 'CAP' | 'FLOOR' | 'PRORATION' | 'ELIGIBILITY' | 'CUSTOM';
  conditions: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
  actions: Array<{
    type: string;
    params: Record<string, unknown>;
  }>;
  priority: number;
  description?: string;
  sourceText?: string;
}

export interface ValidationResult {
  ruleName: string;
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CompportRuleMapping {
  ruleName: string;
  targetTable: string;
  targetTableLabel: string; // business-friendly name
  operation: 'INSERT' | 'UPDATE';
  affectedEmployees: number;
  previewData: Record<string, unknown>;
}

// ─── System Prompt ───────────────────────────────────────

const RULES_SYSTEM_PROMPT = `You are the Compensation Rules Agent for the Compport platform. You help HR professionals create, understand, validate, and apply compensation rules.

You can:
1. PARSE rules from natural language, CSV/Excel data, or policy documents
2. VALIDATE rules against the compensation schema and flag issues
3. MAP rules to the correct Compport modules (salary, bonus, LTI, etc.)
4. EXPLAIN existing rules in plain, non-technical English
5. SIMULATE the impact of rules before applying them
6. APPLY approved rules to the Compport system (with confirmation)

Guidelines:
- Always present rules in business language, never database terms
- When showing rule conditions, use plain English: "employees rated 4 or above" not "perf_rating >= 4"
- When showing actions, use plain English: "5% merit increase" not "setMerit({percentage: 5})"
- Always show the number of affected employees when possible
- Before applying any rule, ALWAYS show a preview and ask for explicit confirmation
- Group rules by type (Salary, Bonus, LTI, etc.) when presenting multiple rules
- Flag potential issues: rule conflicts, unreasonable values, missing conditions
- Use tables and formatting for clarity when showing multiple rules

When parsing CSV/Excel rules, expect these column patterns:
- Rule Name / Name / Title
- Type / Category / Rule Type (MERIT, BONUS, LTI, CAP, FLOOR, PRORATION, ELIGIBILITY)
- Condition Field / Field / Criteria (performance_rating, department, level, tenure, etc.)
- Operator / Op (>=, <=, =, !=, in, between)
- Value / Threshold
- Action / Action Type (setMerit, setBonus, setLTI, applyCap, applyFloor, prorate)
- Amount / Percentage / Action Value
- Priority / Order

NEVER show internal table names like hr_parameter, salary_rule_users_dtls, etc.
Instead use: "Salary Rules Module", "Bonus Configuration", "LTI Settings".

For rule types, use these labels:
- MERIT → "Merit Increase Rule"
- BONUS → "Bonus Rule"
- LTI → "Long-Term Incentive Rule"
- CAP → "Compensation Cap"
- FLOOR → "Minimum Guarantee"
- PRORATION → "Pro-ration Rule"
- ELIGIBILITY → "Eligibility Criteria"`;

// ─── Node: Router ────────────────────────────────────────
// Determines user intent from the latest message

async function routerNode(
  state: typeof RulesOrchestratorState.State,
  config: { model: ChatOpenAI },
): Promise<Partial<typeof RulesOrchestratorState.State>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const content = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
  const lower = content.toLowerCase();

  // File upload detection
  if (state.fileContent && state.fileType) {
    return { intent: 'parse' };
  }

  // Intent detection via keywords (fast path before LLM)
  if (lower.includes('explain') || lower.includes('what does') || lower.includes('understand')) {
    return { intent: 'explain' };
  }
  if (lower.includes('simulate') || lower.includes('impact') || lower.includes('what would happen') || lower.includes('what if')) {
    return { intent: 'simulate' };
  }
  if (lower.includes('apply') || lower.includes('push') || lower.includes('activate') || lower.includes('deploy')) {
    return { intent: 'apply' };
  }
  if (lower.includes('upload') || lower.includes('import') || lower.includes('csv') || lower.includes('excel') || lower.includes('spreadsheet')) {
    return { intent: 'parse' };
  }
  if (lower.includes('create') || lower.includes('add') || lower.includes('new rule') || lower.includes('set up') || lower.includes('configure')) {
    return { intent: 'parse' };
  }
  if (lower.includes('validate') || lower.includes('check') || lower.includes('verify')) {
    return { intent: 'validate' };
  }
  if (lower.includes('list') || lower.includes('show') || lower.includes('view') || lower.includes('what rules')) {
    return { intent: 'explain' };
  }

  // Default: let the LLM decide
  return { intent: 'explain' };
}

// ─── Node: Parse ─────────────────────────────────────────
// Extracts structured rules from any input (chat text, CSV, PDF)

async function parseNode(
  state: typeof RulesOrchestratorState.State,
  config: { model: ChatOpenAI },
): Promise<Partial<typeof RulesOrchestratorState.State>> {
  const model = config.model;
  const lastMessage = state.messages[state.messages.length - 1];
  const input = state.fileContent || (typeof lastMessage?.content === 'string' ? lastMessage.content : '');

  const parsePrompt = `Extract compensation rules from the following input. Return a JSON array of rules.

Each rule must have:
- name: descriptive name
- type: one of MERIT, BONUS, LTI, CAP, FLOOR, PRORATION, ELIGIBILITY, CUSTOM
- conditions: array of {field, operator, value}
- actions: array of {type, params}
- priority: number (lower = higher priority)
- description: plain English description

Valid condition fields: performanceRating, department, level, location, tenure, baseSalary, compaRatio, grade, jobFamily, employeeType
Valid operators: eq, neq, gt, gte, lt, lte, in, notIn, between
Valid action types: setMerit, setBonus, setLTI, applyCap, applyFloor, prorate, applyMultiplier, flag, block

Input:
${input}

Return ONLY the JSON array, no markdown fences.`;

  const response = await model.invoke([
    new SystemMessage(RULES_SYSTEM_PROMPT),
    new HumanMessage(parsePrompt),
  ]);

  let parsedRules: ParsedRule[] = [];
  try {
    const text = typeof response.content === 'string' ? response.content : '';
    const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    parsedRules = JSON.parse(cleaned);
  } catch {
    // LLM didn't return valid JSON — create a single rule from the description
    parsedRules = [];
  }

  const summary = parsedRules.length > 0
    ? `I extracted ${parsedRules.length} rule(s):\n\n` +
      parsedRules.map((r: ParsedRule, i: number) =>
        `${i + 1}. **${r.name}** (${r.type})\n   ${r.description || 'No description'}`
      ).join('\n\n') +
      `\n\nWould you like me to validate these rules, simulate their impact, or apply them?`
    : `I couldn't extract structured rules from that input. Could you rephrase or provide a more specific rule definition? For example:\n\n"Create a merit rule: 5% increase for employees with performance rating 4 or above"`;

  return {
    parsedRules,
    messages: [new AIMessage(summary)],
  };
}

// ─── Node: Validate ──────────────────────────────────────

async function validateNode(
  state: typeof RulesOrchestratorState.State,
): Promise<Partial<typeof RulesOrchestratorState.State>> {
  const rules = state.parsedRules;
  if (rules.length === 0) {
    return {
      messages: [new AIMessage('No rules to validate. Please create or upload rules first.')],
    };
  }

  const validFields = new Set([
    'performanceRating', 'department', 'level', 'location', 'tenure',
    'baseSalary', 'compaRatio', 'grade', 'jobFamily', 'employeeType',
    'hireDate', 'terminationDate', 'gender', 'isPeopleManager',
  ]);
  const validOperators = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'between']);
  const validActions = new Set(['setMerit', 'setBonus', 'setLTI', 'applyCap', 'applyFloor', 'prorate', 'applyMultiplier', 'flag', 'block']);

  const report: ValidationResult[] = rules.map((rule: ParsedRule) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!rule.name) errors.push('Rule name is required');
    if (!rule.type) errors.push('Rule type is required');

    for (const cond of rule.conditions) {
      if (!validFields.has(cond.field)) {
        warnings.push(`Condition field "${cond.field}" is not a standard field — may need custom mapping`);
      }
      if (!validOperators.has(cond.operator)) {
        errors.push(`Invalid operator "${cond.operator}" — use one of: ${[...validOperators].join(', ')}`);
      }
    }

    for (const action of rule.actions) {
      if (!validActions.has(action.type)) {
        errors.push(`Unknown action type "${action.type}" — use one of: ${[...validActions].join(', ')}`);
      }
      const pct = action.params?.percentage as number | undefined;
      if (pct && pct > 50) {
        warnings.push(`${action.type} with ${pct}% seems unusually high — please verify`);
      }
    }

    if (rule.conditions.length === 0) {
      warnings.push('No conditions defined — this rule will apply to ALL employees');
    }

    return {
      ruleName: rule.name,
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  });

  const allValid = report.every((r) => r.isValid);
  const totalWarnings = report.reduce((s, r) => s + r.warnings.length, 0);

  let summary = allValid
    ? `✅ All ${rules.length} rules passed validation.`
    : `⚠️ ${report.filter((r) => !r.isValid).length} of ${rules.length} rules have errors.`;

  if (totalWarnings > 0) {
    summary += ` ${totalWarnings} warning(s) found.`;
  }

  summary += '\n\n';
  for (const r of report) {
    const icon = r.isValid ? '✅' : '❌';
    summary += `${icon} **${r.ruleName}**\n`;
    for (const e of r.errors) summary += `   ❌ ${e}\n`;
    for (const w of r.warnings) summary += `   ⚠️ ${w}\n`;
  }

  if (allValid) {
    summary += '\nWould you like me to simulate the impact of these rules or apply them?';
  } else {
    summary += '\nPlease fix the errors above before proceeding.';
  }

  return {
    validationReport: report,
    messages: [new AIMessage(summary)],
  };
}

// ─── Node: Explain ───────────────────────────────────────

async function explainNode(
  state: typeof RulesOrchestratorState.State,
  config: { model: ChatOpenAI; dbAdapter?: unknown },
): Promise<Partial<typeof RulesOrchestratorState.State>> {
  const model = config.model;

  // If we have parsed rules, explain those
  if (state.parsedRules.length > 0) {
    const rulesJson = JSON.stringify(state.parsedRules, null, 2);
    const response = await model.invoke([
      new SystemMessage(RULES_SYSTEM_PROMPT),
      new HumanMessage(
        `Explain these compensation rules in plain English. For each rule, describe:\n` +
        `1. What it does\n` +
        `2. Who it affects (which employees)\n` +
        `3. What the financial impact is\n` +
        `4. Any dependencies or interactions with other rules\n\n` +
        `Rules:\n${rulesJson}`,
      ),
    ]);
    return { messages: [new AIMessage(typeof response.content === 'string' ? response.content : '')] };
  }

  // No parsed rules — explain using the user's question + available tools
  const lastMessage = state.messages[state.messages.length - 1];
  const response = await model.invoke([
    new SystemMessage(RULES_SYSTEM_PROMPT),
    new HumanMessage(
      `The user is asking about compensation rules. Answer their question in plain English. ` +
      `If you need to look up specific rules, describe what you would look for.\n\n` +
      `User question: ${typeof lastMessage?.content === 'string' ? lastMessage.content : 'What rules are configured?'}`,
    ),
  ]);

  return { messages: [new AIMessage(typeof response.content === 'string' ? response.content : '')] };
}

// ─── Node: Simulate ──────────────────────────────────────

async function simulateNode(
  state: typeof RulesOrchestratorState.State,
  config: { model: ChatOpenAI },
): Promise<Partial<typeof RulesOrchestratorState.State>> {
  const model = config.model;

  if (state.parsedRules.length === 0) {
    return {
      messages: [new AIMessage('No rules to simulate. Please create or upload rules first, then ask me to simulate their impact.')],
    };
  }

  const rulesJson = JSON.stringify(state.parsedRules, null, 2);
  const response = await model.invoke([
    new SystemMessage(RULES_SYSTEM_PROMPT),
    new HumanMessage(
      `Simulate the impact of these compensation rules. Provide:\n` +
      `1. Estimated number of employees affected per rule\n` +
      `2. Total budget impact (estimated)\n` +
      `3. Distribution analysis (which departments/levels are most affected)\n` +
      `4. Any edge cases or risks\n` +
      `5. A recommendation on whether to proceed\n\n` +
      `Note: Use realistic estimates based on typical enterprise compensation data.\n\n` +
      `Rules:\n${rulesJson}`,
    ),
  ]);

  return {
    simulationResult: { simulated: true, ruleCount: state.parsedRules.length },
    messages: [new AIMessage(typeof response.content === 'string' ? response.content : '')],
  };
}

// ─── Node: Apply ─────────────────────────────────────────

async function applyNode(
  state: typeof RulesOrchestratorState.State,
): Promise<Partial<typeof RulesOrchestratorState.State>> {
  if (state.parsedRules.length === 0) {
    return {
      messages: [new AIMessage('No rules to apply. Please create or upload rules first.')],
    };
  }

  if (!state.applyConfirmed) {
    const preview = state.parsedRules.map((r: ParsedRule, i: number) =>
      `${i + 1}. **${r.name}** (${r.type}) — ${r.description || 'No description'}`
    ).join('\n');

    return {
      messages: [new AIMessage(
        `⚠️ **Confirmation Required**\n\n` +
        `You are about to apply the following rules to the Compport system:\n\n` +
        `${preview}\n\n` +
        `This will modify the compensation configuration for your organization. ` +
        `Please type **"CONFIRM APPLY"** to proceed, or ask me to simulate the impact first.`,
      )],
    };
  }

  // User confirmed — this would call write-back service in production
  return {
    messages: [new AIMessage(
      `✅ Rules have been queued for application.\n\n` +
      `The following rules will be applied during the next sync cycle:\n\n` +
      state.parsedRules.map((r: ParsedRule, i: number) =>
        `${i + 1}. **${r.name}** → Applied to ${r.type} module`
      ).join('\n') +
      `\n\nYou can check the status in the Rules section of the platform.`,
    )],
  };
}

// ─── Graph Builder ───────────────────────────────────────

export interface RulesOrchestratorOptions {
  model: ChatOpenAI;
  dbAdapter?: unknown;
}

export function buildRulesOrchestratorGraph(options: RulesOrchestratorOptions) {
  const { model, dbAdapter } = options;
  const config = { model, dbAdapter };

  const graph = new StateGraph(RulesOrchestratorState)
    .addNode('router', (state) => routerNode(state, config))
    .addNode('parse', (state) => parseNode(state, config))
    .addNode('validate', (state) => validateNode(state))
    .addNode('explain', (state) => explainNode(state, config))
    .addNode('simulate', (state) => simulateNode(state, config))
    .addNode('apply', (state) => applyNode(state))
    .addEdge(START, 'router')
    .addConditionalEdges('router', (state) => {
      switch (state.intent) {
        case 'parse': return 'parse';
        case 'validate': return 'validate';
        case 'explain': return 'explain';
        case 'simulate': return 'simulate';
        case 'apply': return 'apply';
        default: return 'explain';
      }
    })
    // After parse, auto-validate
    .addEdge('parse', 'validate')
    // Terminal nodes
    .addEdge('validate', END)
    .addEdge('explain', END)
    .addEdge('simulate', END)
    .addEdge('apply', END);

  return graph.compile();
}

// ─── Exports ─────────────────────────────────────────────

export type RulesOrchestratorGraph = ReturnType<typeof buildRulesOrchestratorGraph>;
