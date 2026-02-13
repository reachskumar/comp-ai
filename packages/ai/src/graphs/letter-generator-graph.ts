/**
 * Letter Generator graph — multi-node LangGraph agent for generating
 * personalized compensation letters (offer, raise, promotion, bonus, total comp summary).
 *
 * Flow: START → select_template → personalize_content → format_letter → END
 */

import { START, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { Annotation } from '@langchain/langgraph';
import { BaseAgentState, type BaseAgentStateType } from '../state.js';
import { createAgentGraph } from '../graph-factory.js';
import type { CreateGraphOptions } from '../graph-factory.js';

// ─── Letter Types ─────────────────────────────────────────

export type LetterType = 'offer' | 'raise' | 'promotion' | 'bonus' | 'total_comp_summary';

export interface LetterEmployeeData {
  firstName: string;
  lastName: string;
  department: string;
  level: string;
  location?: string;
  hireDate?: string;
  currentSalary?: number;
  currency?: string;
}

export interface LetterCompData {
  letterType: LetterType;
  newSalary?: number;
  salaryIncrease?: number;
  salaryIncreasePercent?: number;
  bonusAmount?: number;
  newTitle?: string;
  newLevel?: string;
  effectiveDate?: string;
  totalComp?: number;
  benefits?: string[];
  additionalNotes?: string;
}

export interface LetterGeneratorInput {
  tenantId: string;
  userId: string;
  employee: LetterEmployeeData;
  compData: LetterCompData;
  tone?: string;
  language?: string;
  customInstructions?: string;
}

export interface LetterGeneratorOutput {
  tenantId: string;
  userId: string;
  subject: string;
  content: string;
  letterType: LetterType;
  messages: BaseMessage[];
}

// ─── Extended State ───────────────────────────────────────

const LetterState = Annotation.Root({
  ...BaseAgentState.spec,
  employee: Annotation<LetterEmployeeData>,
  compData: Annotation<LetterCompData>,
  tone: Annotation<string>,
  language: Annotation<string>,
  template: Annotation<string>,
  subject: Annotation<string>,
  content: Annotation<string>,
});

type LetterStateType = typeof LetterState.State;

// ─── System Prompts ───────────────────────────────────────

const TEMPLATE_PROMPT = `You are a compensation letter template selector. Based on the letter type and employee data, select the appropriate template structure.

Return a JSON object with:
- "template": a markdown template with placeholders like {{firstName}}, {{newSalary}}, etc.
- "subject": the email subject line for this letter

Letter types and their templates:
- offer: Welcome/offer letter with compensation package details
- raise: Annual salary increase notification
- promotion: Promotion announcement with new title and compensation
- bonus: Bonus notification with amount and reason
- total_comp_summary: Complete total compensation breakdown

Always respond with valid JSON only, no markdown fences.`;

const PERSONALIZE_PROMPT = `You are a professional HR letter writer for the Compport platform. Your job is to generate personalized, warm, and professional compensation letters.

Guidelines:
- Use the employee's first name naturally throughout
- Be congratulatory and positive in tone
- Include all relevant compensation details with proper formatting
- Format currency amounts with commas and currency symbols
- Keep the letter professional but warm
- Include the effective date when provided
- Structure with clear paragraphs
- End with a positive closing

Tone preference: {{tone}}
Language: {{language}}

Generate the complete letter content in markdown format. Do NOT include the subject line in the body.`;

// ─── Graph Builder ────────────────────────────────────────

export async function buildLetterGeneratorGraph(
  options: CreateGraphOptions = {},
) {
  const { loadAIConfig, resolveModelConfig } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'letter-generator'),
    ...options.modelConfig,
  };

  const model = new ChatOpenAI({
    openAIApiKey: aiConfig.apiKey,
    modelName: modelConfig.model,
    temperature: modelConfig.temperature ?? 0.7,
    maxTokens: modelConfig.maxTokens ?? 2000,
  });

  // Node 1: Select template based on letter type
  async function selectTemplate(
    state: LetterStateType,
  ): Promise<Partial<LetterStateType>> {
    const { employee, compData } = state;
    const prompt = `Letter type: ${compData.letterType}
Employee: ${employee.firstName} ${employee.lastName}
Department: ${employee.department}
Level: ${employee.level}
${compData.newTitle ? `New Title: ${compData.newTitle}` : ''}
${compData.newSalary ? `New Salary: ${compData.newSalary}` : ''}
${compData.bonusAmount ? `Bonus: ${compData.bonusAmount}` : ''}

Select the appropriate template and subject line.`;

    const response = await model.invoke([
      new SystemMessage(TEMPLATE_PROMPT),
      new HumanMessage(prompt),
    ]);

    let template = '';
    let subject = '';
    try {
      const content = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
      const parsed = JSON.parse(content) as { template: string; subject: string };
      template = parsed.template || '';
      subject = parsed.subject || `Compensation Letter - ${employee.firstName} ${employee.lastName}`;
    } catch {
      template = '{{content}}';
      subject = `Compensation Letter - ${employee.firstName} ${employee.lastName}`;
    }

    return {
      template,
      subject,
      messages: [response],
    };
  }

  // Node 2: Personalize content using the template and employee data
  async function personalizeContent(
    state: LetterStateType,
  ): Promise<Partial<LetterStateType>> {
    const { employee, compData, tone, language } = state;

    const personalizePrompt = PERSONALIZE_PROMPT
      .replace('{{tone}}', tone || 'professional')
      .replace('{{language}}', language || 'English');

    const dataContext = `
Employee Details:
- Name: ${employee.firstName} ${employee.lastName}
- Department: ${employee.department}
- Level: ${employee.level}
- Location: ${employee.location || 'N/A'}
- Hire Date: ${employee.hireDate || 'N/A'}
- Current Salary: ${employee.currency || 'USD'} ${employee.currentSalary?.toLocaleString() || 'N/A'}

Compensation Changes:
- Letter Type: ${compData.letterType}
${compData.newSalary ? `- New Salary: ${employee.currency || 'USD'} ${compData.newSalary.toLocaleString()}` : ''}
${compData.salaryIncrease ? `- Salary Increase: ${employee.currency || 'USD'} ${compData.salaryIncrease.toLocaleString()}` : ''}
${compData.salaryIncreasePercent ? `- Increase Percentage: ${compData.salaryIncreasePercent}%` : ''}
${compData.bonusAmount ? `- Bonus Amount: ${employee.currency || 'USD'} ${compData.bonusAmount.toLocaleString()}` : ''}
${compData.newTitle ? `- New Title: ${compData.newTitle}` : ''}
${compData.newLevel ? `- New Level: ${compData.newLevel}` : ''}
${compData.effectiveDate ? `- Effective Date: ${compData.effectiveDate}` : ''}
${compData.totalComp ? `- Total Compensation: ${employee.currency || 'USD'} ${compData.totalComp.toLocaleString()}` : ''}
${compData.benefits?.length ? `- Benefits: ${compData.benefits.join(', ')}` : ''}
${compData.additionalNotes ? `- Additional Notes: ${compData.additionalNotes}` : ''}

Write the complete letter now.`;

    const response = await model.invoke([
      new SystemMessage(personalizePrompt),
      new HumanMessage(dataContext),
    ]);

    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return {
      content,
      messages: [response],
    };
  }

  // Node 3: Format the final letter
  async function formatLetter(
    state: LetterStateType,
  ): Promise<Partial<LetterStateType>> {
    const { content, subject } = state;

    const response = await model.invoke([
      new SystemMessage(`You are a letter formatter. Clean up the letter content:
- Ensure proper paragraph spacing
- Fix any formatting issues
- Ensure the letter has a proper greeting and closing
- Do NOT add a subject line to the body
- Return ONLY the formatted letter content, nothing else`),
      new HumanMessage(content),
    ]);

    const formattedContent = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return {
      content: formattedContent,
      subject,
      messages: [response],
    };
  }

  return createAgentGraph(
    {
      name: 'letter-generator-graph',
      graphType: 'letter-generator',
      stateSchema: LetterState,
      nodes: {
        select_template: selectTemplate,
        personalize_content: personalizeContent,
        format_letter: formatLetter,
      },
      edges: [
        [START, 'select_template'],
        ['select_template', 'personalize_content'],
        ['personalize_content', 'format_letter'],
        ['format_letter', END],
      ],
    },
    { ...options, config: aiConfig },
  );
}

/**
 * Convenience function to invoke the letter generator graph.
 */
export async function invokeLetterGenerator(
  input: LetterGeneratorInput,
  options: CreateGraphOptions = {},
): Promise<LetterGeneratorOutput> {
  const { graph } = await buildLetterGeneratorGraph(options);

  const result = await graph.invoke({
    tenantId: input.tenantId,
    userId: input.userId,
    messages: [],
    metadata: {},
    employee: input.employee,
    compData: input.compData,
    tone: input.tone ?? 'professional',
    language: input.language ?? 'en',
    template: '',
    subject: '',
    content: '',
  });

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    subject: (result as LetterStateType).subject ?? '',
    content: (result as LetterStateType).content ?? '',
    letterType: input.compData.letterType,
    messages: ((result as LetterStateType).messages as BaseMessage[]) ?? [],
  };
}

