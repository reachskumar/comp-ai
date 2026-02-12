import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../../database';
import { CreateFieldMappingDto } from '../dto/create-field-mapping.dto';
import type {
  FieldMappingResult,
  FieldMappingError,
  DateFormatTransformConfig,
  CurrencyTransformConfig,
  EnumMapTransformConfig,
  ConcatenateTransformConfig,
  SplitTransformConfig,
  LookupTransformConfig,
} from '@compensation/shared';

@Injectable()
export class FieldMappingService {
  private readonly logger = new Logger(FieldMappingService.name);

  constructor(private readonly db: DatabaseService) {}

  async create(tenantId: string, dto: CreateFieldMappingDto) {
    // Verify connector belongs to tenant
    const connector = await this.db.client.integrationConnector.findFirst({
      where: { id: dto.connectorId, tenantId },
    });
    if (!connector) {
      throw new NotFoundException(`Connector ${dto.connectorId} not found`);
    }

    return this.db.client.fieldMapping.create({
      data: {
        connectorId: dto.connectorId,
        tenantId,
        sourceField: dto.sourceField,
        targetField: dto.targetField,
        transformType: dto.transformType ?? 'direct',
        transformConfig: (dto.transformConfig ?? {}) as never,
        isRequired: dto.isRequired ?? false,
        defaultValue: dto.defaultValue,
      },
    });
  }

  async findByConnector(tenantId: string, connectorId: string) {
    const connector = await this.db.client.integrationConnector.findFirst({
      where: { id: connectorId, tenantId },
    });
    if (!connector) {
      throw new NotFoundException(`Connector ${connectorId} not found`);
    }

    return this.db.client.fieldMapping.findMany({
      where: { connectorId, tenantId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async delete(tenantId: string, id: string) {
    const mapping = await this.db.client.fieldMapping.findFirst({
      where: { id, tenantId },
    });
    if (!mapping) {
      throw new NotFoundException(`Field mapping ${id} not found`);
    }
    await this.db.client.fieldMapping.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Apply field mappings to transform source data.
   * SECURITY: No eval() or Function() — only safe lookup/map operations.
   */
  applyMappings(
    source: Record<string, unknown>,
    mappings: Array<{
      sourceField: string;
      targetField: string;
      transformType: string;
      transformConfig: Record<string, unknown>;
      isRequired: boolean;
      defaultValue?: string | null;
    }>,
  ): FieldMappingResult {
    const mappedData: Record<string, unknown> = {};
    const errors: FieldMappingError[] = [];

    for (const mapping of mappings) {
      try {
        const sourceValue = this.getNestedValue(source, mapping.sourceField);
        const transformed = this.applyTransform(
          sourceValue,
          mapping.transformType,
          mapping.transformConfig,
          mapping.defaultValue ?? undefined,
          source,
        );

        if (transformed === undefined && mapping.isRequired) {
          errors.push({
            field: mapping.sourceField,
            message: `Required field "${mapping.sourceField}" is missing or empty`,
            sourceValue,
          });
          continue;
        }

        if (transformed !== undefined) {
          this.setNestedValue(mappedData, mapping.targetField, transformed);
        }
      } catch (err) {
        errors.push({
          field: mapping.sourceField,
          message: err instanceof Error ? err.message : 'Transform failed',
          sourceValue: this.getNestedValue(source, mapping.sourceField),
        });
      }
    }

    return {
      success: errors.length === 0,
      mappedData,
      errors,
    };
  }

  /** Get a nested value from an object using dot notation */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  /** Set a nested value in an object using dot notation */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!(part in current) || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]!] = value;
  }

  /**
   * Apply a transform to a value.
   * SECURITY: Only safe, predefined transforms — NO eval() or Function().
   */
  private applyTransform(
    value: unknown,
    transformType: string,
    config: Record<string, unknown>,
    defaultValue: string | undefined,
    fullSource: Record<string, unknown>,
  ): unknown {
    // Handle null/undefined with default
    if (value === null || value === undefined || value === '') {
      if (defaultValue !== undefined) return defaultValue;
      if (transformType === 'default') return config['value'];
      return undefined;
    }

    switch (transformType) {
      case 'direct':
        return value;

      case 'uppercase':
        return String(value).toUpperCase();

      case 'lowercase':
        return String(value).toLowerCase();

      case 'trim':
        return String(value).trim();

      case 'date_format': {
        // Simple ISO date parsing — no arbitrary format strings
        const dateVal = new Date(String(value));
        if (isNaN(dateVal.getTime())) {
          throw new Error(`Invalid date value: ${String(value)}`);
        }
        const targetFormat = (config as unknown as DateFormatTransformConfig).targetFormat;
        if (targetFormat === 'iso') return dateVal.toISOString();
        if (targetFormat === 'date') return dateVal.toISOString().split('T')[0];
        if (targetFormat === 'timestamp') return dateVal.getTime();
        return dateVal.toISOString();
      }

      case 'currency': {
        const currConfig = config as unknown as CurrencyTransformConfig;
        const numVal = Number(value);
        if (isNaN(numVal)) throw new Error(`Invalid number for currency: ${String(value)}`);
        const rate = Number(currConfig.exchangeRate);
        if (isNaN(rate) || rate <= 0) throw new Error('Invalid exchange rate');
        return Math.round(numVal * rate * 100) / 100;
      }

      case 'enum_map': {
        const enumConfig = config as unknown as EnumMapTransformConfig;
        const mappings = enumConfig.mappings ?? {};
        const strVal = String(value);
        if (strVal in mappings) return mappings[strVal];
        if (enumConfig.defaultValue !== undefined) return enumConfig.defaultValue;
        throw new Error(`No mapping found for enum value: ${strVal}`);
      }

      case 'concatenate': {
        const concatConfig = config as unknown as ConcatenateTransformConfig;
        const fields = concatConfig.fields ?? [];
        const separator = concatConfig.separator ?? ' ';
        const values = fields.map((f: string) => {
          const v = this.getNestedValue(fullSource, f);
          return v !== null && v !== undefined ? String(v) : '';
        });
        return values.filter(Boolean).join(separator);
      }

      case 'split': {
        const splitConfig = config as unknown as SplitTransformConfig;
        const parts = String(value).split(splitConfig.separator ?? ' ');
        const idx = splitConfig.index ?? 0;
        return parts[idx] ?? '';
      }

      case 'lookup': {
        const lookupConfig = config as unknown as LookupTransformConfig;
        const table = lookupConfig.table ?? {};
        const lookupKey = String(value);
        if (lookupKey in table) return table[lookupKey];
        if (lookupConfig.defaultValue !== undefined) return lookupConfig.defaultValue;
        throw new Error(`No lookup entry for: ${lookupKey}`);
      }

      case 'default':
        return value ?? config['value'];

      default:
        throw new Error(`Unknown transform type: ${transformType}`);
    }
  }


}
