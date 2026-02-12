/**
 * Field Mapping Types
 * Types for the field mapping engine that transforms data between systems.
 */

import type { TransformType } from './connector.types.js';

export interface FieldMappingDefinition {
  id: string;
  connectorId: string;
  sourceField: string;
  targetField: string;
  transformType: TransformType;
  transformConfig: Record<string, unknown>;
  isRequired: boolean;
  defaultValue?: string;
  enabled: boolean;
}

/** Date format transform configuration */
export interface DateFormatTransformConfig {
  sourceFormat: string;
  targetFormat: string;
}

/** Currency transform configuration */
export interface CurrencyTransformConfig {
  sourceCurrency: string;
  targetCurrency: string;
  exchangeRate: number;
}

/** Enum mapping transform configuration */
export interface EnumMapTransformConfig {
  mappings: Record<string, string>;
  defaultValue?: string;
}

/** Concatenate transform configuration */
export interface ConcatenateTransformConfig {
  fields: string[];
  separator: string;
}

/** Split transform configuration */
export interface SplitTransformConfig {
  separator: string;
  index: number;
}

/** Lookup transform configuration */
export interface LookupTransformConfig {
  table: Record<string, string>;
  defaultValue?: string;
}

export interface FieldMappingResult {
  success: boolean;
  mappedData: Record<string, unknown>;
  errors: FieldMappingError[];
}

export interface FieldMappingError {
  field: string;
  message: string;
  sourceValue?: unknown;
}

