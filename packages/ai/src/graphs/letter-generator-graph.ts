/**
 * Letter generator — single LLM call that returns a structured JSON letter.
 * The HTML rendering lives in the API service so this package stays UI-free.
 */

import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { CreateGraphOptions } from '../graph-factory.js';

// ─── Public types ─────────────────────────────────────────

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

// ─── Prompt ───────────────────────────────────────────────

const PERSONALIZE_PROMPT = `You write compensation letter content. Return a JSON object ONLY.

JSON format:
{
  "subject": "short email subject line",
  "paragraphs": ["paragraph 1 text", "paragraph 2 text", "paragraph 3 text"],
  "compensation": [
    {"label": "Base Salary", "value": "$150,000"},
    {"label": "Annual Bonus", "value": "$25,000"},
    {"label": "RSU Grant", "value": "500 shares"},
    {"label": "Total", "value": "$175,000 + RSUs"}
  ],
  "ceoQuote": "A warm, personal message from the CEO recognizing this employee's contributions..."
}

RULES:
- paragraphs: 3-4 warm, congratulatory paragraphs. Use first name naturally. Mention department, role, achievements.
- compensation: include ALL comp components mentioned in the input. Use $ with commas.
- ceoQuote: a heartfelt 2-3 sentence message. Personal and inspiring.
- subject: concise, celebratory subject line.
- DO NOT include any HTML, markdown, signature, date, or company name in the text.
- DO NOT include "Dear Name" or "Warm regards" — the template adds those.
- Return ONLY valid JSON, no markdown fences, no extra text.

Tone: {{tone}}
Language: write the entire letter in {{language}}.`;

// ─── Invoker ──────────────────────────────────────────────

export async function invokeLetterGenerator(
  input: LetterGeneratorInput,
  options: CreateGraphOptions = {},
): Promise<LetterGeneratorOutput> {
  const { loadAIConfig, resolveModelConfig, createChatModel } = await import('../config.js');
  const aiConfig = options.config ?? loadAIConfig();
  const modelConfig = {
    ...resolveModelConfig(aiConfig, 'letter-generator'),
    ...options.modelConfig,
  };
  const model = await createChatModel(aiConfig, modelConfig);

  const { employee, compData } = input;
  const tone = input.tone ?? 'professional';
  const language = input.language ?? 'English';

  const systemPrompt = PERSONALIZE_PROMPT.replace('{{tone}}', tone).replace(
    '{{language}}',
    language,
  );

  const userPrompt = `Generate a ${compData.letterType} letter for ${employee.firstName} ${employee.lastName}.

Employee: ${employee.firstName} ${employee.lastName}, ${employee.department}, ${employee.level}
Location: ${employee.location || 'N/A'}, Hire Date: ${employee.hireDate || 'N/A'}
Current Salary: ${employee.currency || 'USD'} ${employee.currentSalary?.toLocaleString() || 'N/A'}
${compData.newSalary ? `New Salary: ${employee.currency || 'USD'} ${compData.newSalary.toLocaleString()}` : ''}
${compData.salaryIncreasePercent ? `Increase: ${compData.salaryIncreasePercent}%` : ''}
${compData.bonusAmount ? `Bonus: ${employee.currency || 'USD'} ${compData.bonusAmount.toLocaleString()}` : ''}
${compData.newTitle ? `New Title: ${compData.newTitle}` : ''}
${compData.effectiveDate ? `Effective: ${compData.effectiveDate}` : ''}
${compData.additionalNotes ? `Additional notes: ${compData.additionalNotes}` : ''}
${input.customInstructions ? `Custom instructions: ${input.customInstructions}` : ''}

Return ONLY valid JSON, no markdown fences.`;

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]);

  const raw =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  let subject = `${compData.letterType} letter - ${employee.firstName} ${employee.lastName}`;
  let content = raw;
  try {
    const parsed = JSON.parse(
      raw
        .replace(/```json?\s*/gi, '')
        .replace(/```/g, '')
        .trim(),
    ) as { subject?: string };
    if (typeof parsed.subject === 'string' && parsed.subject.trim()) {
      subject = parsed.subject;
    }
    content = JSON.stringify(parsed);
  } catch {
    // Leave raw content; the API will detect the parse failure and surface an error.
  }

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    subject,
    content,
    letterType: compData.letterType,
    messages: [response],
  };
}
