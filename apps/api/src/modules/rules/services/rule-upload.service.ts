import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { parseCSV } from '@compensation/shared';
import {
  invokeFieldMappingGraph,
  type FieldSchema,
  type FieldMappingGraphOutput,
} from '@compensation/ai';
import * as ExcelJS from 'exceljs';

/**
 * Column-header aliases → RuleType mapping.
 * The key is a lowercase substring match; the value is the RuleType enum string.
 */
const HEADER_RULE_MAP: Record<string, string> = {
  // MERIT
  merit: 'MERIT',
  'merit %': 'MERIT',
  'merit increase': 'MERIT',
  'salary increase': 'MERIT',
  'annual increase': 'MERIT',
  raise: 'MERIT',
  'pay increase': 'MERIT',
  // BONUS
  bonus: 'BONUS',
  'bonus target': 'BONUS',
  'bonus %': 'BONUS',
  incentive: 'BONUS',
  'variable pay': 'BONUS',
  'performance bonus': 'BONUS',
  'target bonus': 'BONUS',
  // LTI
  lti: 'LTI',
  'long term': 'LTI',
  stock: 'LTI',
  equity: 'LTI',
  rsu: 'LTI',
  esop: 'LTI',
  option: 'LTI',
  vesting: 'LTI',
  // PRORATION
  proration: 'PRORATION',
  prorated: 'PRORATION',
  'pro-rata': 'PRORATION',
  'pro rata': 'PRORATION',
  'tenure factor': 'PRORATION',
  // CAP
  cap: 'CAP',
  max: 'CAP',
  maximum: 'CAP',
  ceiling: 'CAP',
  'upper limit': 'CAP',
  // FLOOR
  floor: 'FLOOR',
  min: 'FLOOR',
  minimum: 'FLOOR',
  'lower limit': 'FLOOR',
  // ELIGIBILITY
  eligibility: 'ELIGIBILITY',
  eligible: 'ELIGIBILITY',
  qualification: 'ELIGIBILITY',
  criteria: 'ELIGIBILITY',
  requirement: 'ELIGIBILITY',
};

/** Detect RuleType from a column header string */
function detectRuleType(header: string): string | null {
  const h = header.toLowerCase().trim();
  // Exact match first
  if (HEADER_RULE_MAP[h]) return HEADER_RULE_MAP[h];
  // Substring match
  for (const [key, ruleType] of Object.entries(HEADER_RULE_MAP)) {
    if (h.includes(key)) return ruleType;
  }
  return null;
}

export interface ParsedRuleRow {
  rowIndex: number;
  name: string;
  ruleType: string;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  rawData: Record<string, string>;
  warnings: string[];
}

export interface AiColumnMapping {
  sourceColumn: string;
  targetField: string;
  confidence: number;
  transformType: string;
  reasoning: string;
}

export interface RuleUploadPreview {
  id: string;
  fileName: string;
  totalRows: number;
  parsedRules: ParsedRuleRow[];
  unmappedColumns: string[];
  errors: string[];
  ruleTypeSummary: Record<string, number>;
  /** Present when ai=true — AI-suggested column mappings */
  aiMappingSuggestions?: AiColumnMapping[];
  /** Overall confidence of AI mapping (0-1) */
  aiMappingConfidence?: number;
}

@Injectable()
export class RuleUploadService {
  private readonly logger = new Logger(RuleUploadService.name);
  /** In-memory store for upload previews (production should use Redis/DB) */
  private readonly previews = new Map<string, RuleUploadPreview>();

  constructor(private readonly db: DatabaseService) {}

  /**
   * Parse an uploaded file (CSV or Excel) and return a preview.
   * When aiMapping=true, uses the AI field-mapping graph to suggest column mappings.
   */
  async parseUpload(
    tenantId: string,
    userId: string,
    fileName: string,
    fileBuffer: Buffer,
    aiMapping = false,
  ): Promise<RuleUploadPreview> {
    const ext = fileName.toLowerCase().split('.').pop() ?? '';
    let headers: string[];
    let rows: string[][];

    if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
      const text = fileBuffer.toString('utf-8');
      const parsed = parseCSV(text);
      headers = parsed.headers;
      rows = parsed.rows;
    } else if (ext === 'xlsx' || ext === 'xls') {
      const result = await this.parseExcel(fileBuffer);
      headers = result.headers;
      rows = result.rows;
    } else {
      throw new BadRequestException(`Unsupported file type: .${ext}. Use CSV or Excel (.xlsx).`);
    }

    if (headers.length === 0 || rows.length === 0) {
      throw new BadRequestException('File is empty or has no data rows.');
    }

    const preview = this.buildPreview(tenantId, fileName, headers, rows);

    if (aiMapping) {
      const aiResult = await this.aiMapColumns(tenantId, userId, headers, rows);
      preview.aiMappingSuggestions = aiResult.suggestions.map((s) => ({
        sourceColumn: s.sourceField,
        targetField: s.targetField,
        confidence: s.confidence,
        transformType: s.transformType,
        reasoning: s.reasoning,
      }));
      preview.aiMappingConfidence = aiResult.overallConfidence;
      this.logger.log(
        `AI mapping for ${fileName}: ${aiResult.suggestions.length} suggestions, confidence=${aiResult.overallConfidence}`,
      );
    }

    return preview;
  }

  /**
   * Use the AI field-mapping graph to suggest how CSV columns map to
   * compensation rule fields (rule types + condition fields).
   */
  private async aiMapColumns(
    tenantId: string,
    userId: string,
    headers: string[],
    rows: string[][],
  ): Promise<FieldMappingGraphOutput> {
    // Build source fields from CSV headers + sample values
    const sampleRows = rows.slice(0, 5);
    const sourceFields: FieldSchema[] = headers.map((header, idx) => {
      const samples = sampleRows.map((row) => row[idx] ?? '').filter((v) => v.trim() !== '');
      return {
        name: header,
        type: 'string',
        required: false,
        description: `CSV column "${header}"`,
        sampleValues: samples.slice(0, 3),
      };
    });

    // Build target fields from rule types + condition keywords
    const ruleTypeFields: FieldSchema[] = [
      {
        name: 'Rule Name',
        type: 'string',
        required: true,
        description: 'Name or label for the compensation rule',
      },
      {
        name: 'Rule Type',
        type: 'enum',
        required: false,
        description: 'Type of compensation rule',
        enumValues: ['MERIT', 'BONUS', 'LTI', 'PRORATION', 'CAP', 'FLOOR', 'ELIGIBILITY', 'CUSTOM'],
      },
      {
        name: 'Merit %',
        type: 'number',
        required: false,
        description: 'Merit increase percentage',
      },
      { name: 'Bonus %', type: 'number', required: false, description: 'Bonus target percentage' },
      {
        name: 'LTI Value',
        type: 'number',
        required: false,
        description: 'Long-term incentive value (stock/equity)',
      },
      {
        name: 'Cap / Maximum',
        type: 'number',
        required: false,
        description: 'Upper limit or cap for compensation',
      },
      {
        name: 'Floor / Minimum',
        type: 'number',
        required: false,
        description: 'Lower limit or floor for compensation',
      },
      {
        name: 'Proration Factor',
        type: 'number',
        required: false,
        description: 'Pro-rata factor based on tenure',
      },
      {
        name: 'Eligibility',
        type: 'string',
        required: false,
        description: 'Eligibility criteria or qualification flag',
      },
      {
        name: 'Value / Amount',
        type: 'number',
        required: false,
        description: 'Generic value or amount column',
      },
    ];

    const conditionFields: FieldSchema[] = [
      { name: 'Grade', type: 'string', required: false, description: 'Employee grade or level' },
      { name: 'Band', type: 'string', required: false, description: 'Compensation band' },
      {
        name: 'Department',
        type: 'string',
        required: false,
        description: 'Department or business unit',
      },
      {
        name: 'Performance Rating',
        type: 'string',
        required: false,
        description: 'Performance review rating',
      },
      {
        name: 'Tenure',
        type: 'number',
        required: false,
        description: 'Years of service or tenure',
      },
      {
        name: 'Location',
        type: 'string',
        required: false,
        description: 'Employee location or region',
      },
      {
        name: 'Job Family',
        type: 'string',
        required: false,
        description: 'Job family or function',
      },
      {
        name: 'Compa-Ratio',
        type: 'number',
        required: false,
        description: 'Compa-ratio (salary vs market midpoint)',
      },
      {
        name: 'Designation',
        type: 'string',
        required: false,
        description: 'Job title or designation',
      },
    ];

    const targetFields = [...ruleTypeFields, ...conditionFields];

    return invokeFieldMappingGraph({
      tenantId,
      userId,
      connectorType: 'CSV Rule Upload',
      sourceFields,
      targetFields,
    });
  }

  private async parseExcel(buffer: Buffer): Promise<{ headers: string[]; rows: string[][] }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) {
      throw new BadRequestException('Excel file has no data. Ensure data is on the first sheet.');
    }

    const headers: string[] = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value ?? '').trim();
    });

    const rows: string[][] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const values: string[] = [];
      let hasData = false;
      for (let c = 0; c < headers.length; c++) {
        const val = String(row.getCell(c + 1).value ?? '').trim();
        values.push(val);
        if (val) hasData = true;
      }
      if (hasData) rows.push(values);
    }

    return { headers: headers.filter(Boolean), rows };
  }

  private buildPreview(
    tenantId: string,
    fileName: string,
    headers: string[],
    rows: string[][],
  ): RuleUploadPreview {
    const id = `upload-${tenantId}-${Date.now()}`;
    const parsedRules: ParsedRuleRow[] = [];
    const errors: string[] = [];
    const unmappedColumns: string[] = [];
    const ruleTypeSummary: Record<string, number> = {};

    // Detect which columns map to rule types
    const columnMapping: Array<{ index: number; header: string; ruleType: string | null }> =
      headers.map((h, i) => ({ index: i, header: h, ruleType: detectRuleType(h) }));

    // Find name/label column
    const nameColIdx = headers.findIndex((h) =>
      /^(name|rule.?name|label|title|description|rule)/i.test(h.trim()),
    );
    // Find condition-related columns
    const conditionKeywords = [
      'grade',
      'level',
      'band',
      'department',
      'rating',
      'performance',
      'tenure',
      'location',
      'job family',
      'compa-ratio',
      'compa ratio',
      'designation',
    ];

    for (const cm of columnMapping) {
      if (
        !cm.ruleType &&
        !conditionKeywords.some((k) => cm.header.toLowerCase().includes(k)) &&
        cm.index !== nameColIdx
      ) {
        unmappedColumns.push(cm.header);
      }
    }

    // Parse each row into a rule
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri]!;
      const rawData: Record<string, string> = {};
      headers.forEach((h, i) => {
        rawData[h] = row[i] ?? '';
      });

      // Determine rule name
      const ruleName =
        nameColIdx >= 0 && row[nameColIdx] ? row[nameColIdx]! : `Rule from row ${ri + 2}`;

      // Build conditions from condition-like columns
      const conditions: Record<string, unknown> = {};
      for (const cm of columnMapping) {
        if (conditionKeywords.some((k) => cm.header.toLowerCase().includes(k))) {
          const val = row[cm.index]?.trim();
          if (val) conditions[cm.header] = val;
        }
      }

      // Build actions from rule-type columns
      const warnings: string[] = [];
      const ruleTypeCols = columnMapping.filter((cm) => cm.ruleType && row[cm.index]?.trim());

      if (ruleTypeCols.length === 0) {
        // Try to detect from a "type" column
        const typeColIdx = headers.findIndex((h) => /^(type|rule.?type|category)/i.test(h));
        const typeVal = typeColIdx >= 0 ? (row[typeColIdx] ?? '').toUpperCase().trim() : '';
        const validTypes = [
          'MERIT',
          'BONUS',
          'LTI',
          'PRORATION',
          'CAP',
          'FLOOR',
          'ELIGIBILITY',
          'CUSTOM',
        ];

        if (validTypes.includes(typeVal)) {
          // Value column
          const valueColIdx = headers.findIndex((h) =>
            /^(value|amount|percentage|%|rate)/i.test(h),
          );
          const val = valueColIdx >= 0 ? row[valueColIdx] : '';
          parsedRules.push({
            rowIndex: ri + 2,
            name: ruleName,
            ruleType: typeVal,
            conditions: { filters: [conditions] },
            actions: { adjustments: [{ type: typeVal, value: val }] },
            rawData,
            warnings,
          });
          ruleTypeSummary[typeVal] = (ruleTypeSummary[typeVal] ?? 0) + 1;
        } else {
          errors.push(`Row ${ri + 2}: Could not determine rule type — no matching column headers.`);
        }
        continue;
      }

      // Create one rule per rule-type column that has a value
      for (const rtCol of ruleTypeCols) {
        const ruleType = rtCol.ruleType!;
        const value = row[rtCol.index]?.trim() ?? '';
        parsedRules.push({
          rowIndex: ri + 2,
          name: `${ruleName} — ${ruleType}`,
          ruleType,
          conditions: { filters: [conditions] },
          actions: { adjustments: [{ type: ruleType, value, column: rtCol.header }] },
          rawData,
          warnings,
        });
        ruleTypeSummary[ruleType] = (ruleTypeSummary[ruleType] ?? 0) + 1;
      }
    }

    const preview: RuleUploadPreview = {
      id,
      fileName,
      totalRows: rows.length,
      parsedRules,
      unmappedColumns,
      errors,
      ruleTypeSummary,
    };
    this.previews.set(id, preview);
    return preview;
  }

  /**
   * Approve a previewed upload — persist rules into a new RuleSet.
   */
  async approveUpload(tenantId: string, uploadId: string, ruleSetName?: string): Promise<unknown> {
    const preview = this.previews.get(uploadId);
    if (!preview) throw new NotFoundException(`Upload preview ${uploadId} not found or expired.`);

    if (preview.parsedRules.length === 0) {
      throw new BadRequestException('No valid rules to import.');
    }

    const name = ruleSetName ?? `Imported from ${preview.fileName}`;

    const ruleSet = await this.db.forTenant(tenantId, (tx) =>
      tx.ruleSet.create({
        data: {
          tenantId,
          name,
          description: `Imported ${preview.parsedRules.length} rules from ${preview.fileName}`,
          status: 'DRAFT',
          rules: {
            create: preview.parsedRules.map((r, idx) => ({
              name: r.name,
              ruleType: r.ruleType as never,
              priority: idx,
              conditions: r.conditions as never,
              actions: r.actions as never,
              metadata: { importedFrom: preview.fileName, rowIndex: r.rowIndex } as never,
              enabled: true,
            })),
          },
        },
        include: { rules: true },
      }),
    );

    this.previews.delete(uploadId);
    this.logger.log(
      `Rule upload approved: tenant=${tenantId} ruleSet=${ruleSet.id} rules=${ruleSet.rules.length}`,
    );

    return {
      ruleSetId: ruleSet.id,
      name: ruleSet.name,
      rulesCreated: ruleSet.rules.length,
      ruleTypeSummary: preview.ruleTypeSummary,
    };
  }
}
