/**
 * Integration Connector Types
 * Shared between API and frontend.
 */

export type ConnectorType = 'HRIS' | 'PAYROLL' | 'BENEFITS' | 'SSO' | 'CUSTOM';
export type ConnectorStatus = 'ACTIVE' | 'INACTIVE' | 'ERROR' | 'PENDING';
export type SyncDirection = 'INBOUND' | 'OUTBOUND' | 'BIDIRECTIONAL';
export type SyncSchedule = 'REALTIME' | 'HOURLY' | 'DAILY' | 'MANUAL';
export type ConflictStrategy = 'LAST_WRITE_WINS' | 'MANUAL_REVIEW' | 'SOURCE_PRIORITY';

export interface ConnectorSchema {
  entities: EntitySchema[];
}

export interface EntitySchema {
  name: string;
  fields: EntityField[];
}

export interface EntityField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'object';
  required: boolean;
  description?: string;
  enumValues?: string[];
}

/**
 * Universal Connector Interface
 * Every integration connector must implement this interface.
 */
export interface IConnector {
  /** Unique connector type identifier */
  readonly type: ConnectorType;

  /** Establish connection to the external system */
  connect(config: ConnectorConfig): Promise<ConnectorConnectionResult>;

  /** Disconnect from the external system */
  disconnect(): Promise<void>;

  /** Check if the connection is healthy */
  healthCheck(): Promise<ConnectorHealthResult>;

  /** Sync data between systems */
  sync(options: SyncOptions): Promise<SyncResult>;

  /** Map fields from source to target format */
  mapFields(source: Record<string, unknown>, mappings: FieldMappingConfig[]): Record<string, unknown>;

  /** Get the schema of available entities and fields */
  getSchema(): Promise<ConnectorSchema>;
}

export interface ConnectorConfig {
  /** Base URL for the external API */
  baseUrl?: string;
  /** Additional configuration specific to the connector */
  [key: string]: unknown;
}

export interface ConnectorConnectionResult {
  success: boolean;
  message?: string;
}

export interface ConnectorHealthResult {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
  checkedAt: Date;
}

export interface SyncOptions {
  direction: SyncDirection;
  entityType: string;
  /** Only sync records changed after this date */
  since?: Date;
  /** Conflict resolution strategy */
  conflictStrategy?: ConflictStrategy;
  /** Maximum records to process in this batch */
  batchSize?: number;
}

export interface SyncResult {
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  skippedRecords: number;
  errors: SyncError[];
}

export interface SyncError {
  entityId: string;
  entityType: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface FieldMappingConfig {
  sourceField: string;
  targetField: string;
  transformType: TransformType;
  transformConfig?: Record<string, unknown>;
  isRequired?: boolean;
  defaultValue?: string;
}

export type TransformType =
  | 'direct'        // Direct copy
  | 'date_format'   // Date format conversion
  | 'currency'      // Currency conversion
  | 'enum_map'      // Enum value mapping
  | 'concatenate'   // Concatenate multiple fields
  | 'split'         // Split a field
  | 'uppercase'     // Convert to uppercase
  | 'lowercase'     // Convert to lowercase
  | 'trim'          // Trim whitespace
  | 'default'       // Use default value if empty
  | 'lookup';       // Lookup from a mapping table

