/**
 * Pre-built Connector Templates
 *
 * Mock/sandbox connector definitions for Workday, BambooHR, ADP, and SAP SuccessFactors.
 * Each template defines the connector's schema, default field mappings, and auth config.
 */

import type { FieldSchema } from '@compensation/ai';

export interface ConnectorTemplate {
  id: string;
  name: string;
  description: string;
  connectorType: 'HRIS' | 'PAYROLL' | 'BENEFITS' | 'SSO' | 'CUSTOM' | 'COMPPORT_CLOUDSQL';
  vendor: string;
  logoUrl?: string;
  category: string;
  authType: 'oauth2' | 'api_key' | 'basic';
  authConfig: Record<string, unknown>;
  sourceSchema: FieldSchema[];
  defaultSyncDirection: 'INBOUND' | 'OUTBOUND' | 'BIDIRECTIONAL';
  defaultSyncSchedule: 'REALTIME' | 'HOURLY' | 'DAILY' | 'MANUAL';
  supportedEntities: string[];
  sandboxMode: boolean;
}

// ─── Common Compport Target Schema ──────────────────────────

export const COMPPORT_TARGET_SCHEMA: FieldSchema[] = [
  { name: 'employeeId', type: 'string', required: true, description: 'Unique employee identifier' },
  { name: 'firstName', type: 'string', required: true, description: 'First name' },
  { name: 'lastName', type: 'string', required: true, description: 'Last name' },
  { name: 'email', type: 'string', required: true, description: 'Work email address' },
  { name: 'department', type: 'string', required: false, description: 'Department name' },
  { name: 'jobTitle', type: 'string', required: false, description: 'Job title' },
  { name: 'jobLevel', type: 'string', required: false, description: 'Job level/grade' },
  { name: 'managerId', type: 'string', required: false, description: 'Manager employee ID' },
  { name: 'location', type: 'string', required: false, description: 'Work location' },
  { name: 'hireDate', type: 'date', required: false, description: 'Date of hire' },
  { name: 'baseSalary', type: 'number', required: false, description: 'Base salary amount' },
  { name: 'currency', type: 'string', required: false, description: 'Salary currency code' },
  {
    name: 'payFrequency',
    type: 'enum',
    required: false,
    description: 'Pay frequency',
    enumValues: ['ANNUAL', 'MONTHLY', 'BIWEEKLY', 'WEEKLY'],
  },
  {
    name: 'employmentStatus',
    type: 'enum',
    required: false,
    description: 'Employment status',
    enumValues: ['ACTIVE', 'INACTIVE', 'TERMINATED', 'ON_LEAVE'],
  },
  {
    name: 'employmentType',
    type: 'enum',
    required: false,
    description: 'Employment type',
    enumValues: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'],
  },
];

// ─── Workday ────────────────────────────────────────────────

export const WORKDAY_TEMPLATE: ConnectorTemplate = {
  id: 'workday',
  name: 'Workday',
  description: 'HRIS data sync for employee records, org structure, and job profiles.',
  connectorType: 'HRIS',
  vendor: 'Workday',
  category: 'HRIS',
  authType: 'oauth2',
  authConfig: {
    authUrl: 'https://impl.workday.com/oauth2/authorize',
    tokenUrl: 'https://impl.workday.com/oauth2/token',
    scopes: ['r:employees', 'r:organizations', 'r:compensation'],
  },
  sourceSchema: [
    { name: 'Worker_ID', type: 'string', required: true, description: 'Workday Worker ID' },
    { name: 'First_Name', type: 'string', required: true, description: 'Legal first name' },
    { name: 'Last_Name', type: 'string', required: true, description: 'Legal last name' },
    { name: 'Email_Address', type: 'string', required: true, description: 'Primary email' },
    {
      name: 'Supervisory_Organization',
      type: 'string',
      required: false,
      description: 'Department/org',
    },
    { name: 'Business_Title', type: 'string', required: false, description: 'Business title' },
    { name: 'Job_Profile', type: 'string', required: false, description: 'Job profile name' },
    { name: 'Manager_ID', type: 'string', required: false, description: 'Manager Worker ID' },
    { name: 'Location', type: 'string', required: false, description: 'Work location' },
    { name: 'Hire_Date', type: 'date', required: false, description: 'Original hire date' },
    { name: 'Annual_Rate', type: 'number', required: false, description: 'Annual base pay' },
    { name: 'Currency_Code', type: 'string', required: false, description: 'Pay currency' },
    {
      name: 'Pay_Rate_Type',
      type: 'enum',
      required: false,
      description: 'Pay rate type',
      enumValues: ['Salary', 'Hourly'],
    },
    {
      name: 'Worker_Status',
      type: 'enum',
      required: false,
      description: 'Worker status',
      enumValues: ['Active', 'Inactive', 'Terminated', 'On Leave'],
    },
    {
      name: 'Worker_Type',
      type: 'enum',
      required: false,
      description: 'Worker type',
      enumValues: ['Regular', 'Temporary', 'Contractor'],
    },
  ],
  defaultSyncDirection: 'INBOUND',
  defaultSyncSchedule: 'DAILY',
  supportedEntities: ['employees', 'departments', 'job_profiles', 'compensation'],
  sandboxMode: true,
};

// ─── BambooHR ───────────────────────────────────────────────

export const BAMBOOHR_TEMPLATE: ConnectorTemplate = {
  id: 'bamboohr',
  name: 'BambooHR',
  description: 'Lightweight HRIS connector for SMB employee data synchronization.',
  connectorType: 'HRIS',
  vendor: 'BambooHR',
  category: 'HRIS',
  authType: 'api_key',
  authConfig: { headerName: 'Authorization', prefix: 'Basic' },
  sourceSchema: [
    { name: 'id', type: 'string', required: true, description: 'BambooHR employee ID' },
    { name: 'firstName', type: 'string', required: true, description: 'First name' },
    { name: 'lastName', type: 'string', required: true, description: 'Last name' },
    { name: 'workEmail', type: 'string', required: true, description: 'Work email' },
    { name: 'department', type: 'string', required: false, description: 'Department' },
    { name: 'jobTitle', type: 'string', required: false, description: 'Job title' },
    { name: 'supervisorId', type: 'string', required: false, description: 'Supervisor ID' },
    { name: 'location', type: 'string', required: false, description: 'Location' },
    { name: 'hireDate', type: 'date', required: false, description: 'Hire date' },
    { name: 'payRate', type: 'number', required: false, description: 'Pay rate' },
    {
      name: 'payType',
      type: 'enum',
      required: false,
      description: 'Pay type',
      enumValues: ['Salary', 'Hourly'],
    },
    {
      name: 'status',
      type: 'enum',
      required: false,
      description: 'Status',
      enumValues: ['Active', 'Inactive'],
    },
  ],
  defaultSyncDirection: 'INBOUND',
  defaultSyncSchedule: 'DAILY',
  supportedEntities: ['employees', 'departments', 'time_off'],
  sandboxMode: true,
};

// ─── ADP Workforce Now ──────────────────────────────────────

export const ADP_TEMPLATE: ConnectorTemplate = {
  id: 'adp',
  name: 'ADP Workforce Now',
  description: 'Payroll and HR data integration for compensation workflows.',
  connectorType: 'PAYROLL',
  vendor: 'ADP',
  category: 'Payroll',
  authType: 'oauth2',
  authConfig: {
    authUrl: 'https://accounts.adp.com/auth/oauth/v2/authorize',
    tokenUrl: 'https://accounts.adp.com/auth/oauth/v2/token',
    scopes: ['api'],
  },
  sourceSchema: [
    { name: 'associateOID', type: 'string', required: true, description: 'ADP Associate OID' },
    {
      name: 'person.legalName.givenName',
      type: 'string',
      required: true,
      description: 'Given name',
    },
    {
      name: 'person.legalName.familyName1',
      type: 'string',
      required: true,
      description: 'Family name',
    },
    {
      name: 'businessCommunication.emailUri',
      type: 'string',
      required: false,
      description: 'Email',
    },
    {
      name: 'organizationUnit',
      type: 'string',
      required: false,
      description: 'Org unit/department',
    },
    { name: 'jobTitle', type: 'string', required: false, description: 'Job title' },
    { name: 'reportsTo.associateOID', type: 'string', required: false, description: 'Manager OID' },
    { name: 'workLocation', type: 'string', required: false, description: 'Work location' },
    { name: 'hireDate', type: 'date', required: false, description: 'Hire date' },
    { name: 'baseRemuneration.amount', type: 'number', required: false, description: 'Base pay' },
    {
      name: 'baseRemuneration.currencyCode',
      type: 'string',
      required: false,
      description: 'Currency',
    },
    {
      name: 'payFrequency',
      type: 'enum',
      required: false,
      description: 'Pay frequency',
      enumValues: ['Annual', 'Monthly', 'Biweekly', 'Weekly'],
    },
    {
      name: 'workerStatus',
      type: 'enum',
      required: false,
      description: 'Status',
      enumValues: ['Active', 'Inactive', 'Terminated'],
    },
  ],
  defaultSyncDirection: 'INBOUND',
  defaultSyncSchedule: 'DAILY',
  supportedEntities: ['employees', 'payroll', 'benefits', 'time'],
  sandboxMode: true,
};

// ─── SAP SuccessFactors ─────────────────────────────────────

export const SAP_SF_TEMPLATE: ConnectorTemplate = {
  id: 'sap-successfactors',
  name: 'SAP SuccessFactors',
  description: 'Employee central integration for compensation and benefits data.',
  connectorType: 'HRIS',
  vendor: 'SAP',
  category: 'HRIS',
  authType: 'oauth2',
  authConfig: {
    authUrl: 'https://api.successfactors.com/oauth/authorize',
    tokenUrl: 'https://api.successfactors.com/oauth/token',
    scopes: ['read:employee', 'read:compensation'],
  },
  sourceSchema: [
    { name: 'userId', type: 'string', required: true, description: 'SF User ID' },
    { name: 'firstName', type: 'string', required: true, description: 'First name' },
    { name: 'lastName', type: 'string', required: true, description: 'Last name' },
    { name: 'email', type: 'string', required: true, description: 'Email address' },
    { name: 'department', type: 'string', required: false, description: 'Department' },
    { name: 'jobTitle', type: 'string', required: false, description: 'Job title' },
    { name: 'jobCode', type: 'string', required: false, description: 'Job code/level' },
    { name: 'managerId', type: 'string', required: false, description: 'Manager user ID' },
    { name: 'location', type: 'string', required: false, description: 'Location' },
    { name: 'startDate', type: 'date', required: false, description: 'Start date' },
    { name: 'compensation.salary', type: 'number', required: false, description: 'Base salary' },
    { name: 'compensation.currency', type: 'string', required: false, description: 'Currency' },
    {
      name: 'compensation.frequency',
      type: 'enum',
      required: false,
      description: 'Pay frequency',
      enumValues: ['ANNUAL', 'MONTHLY', 'BIWEEKLY'],
    },
    {
      name: 'employmentStatus',
      type: 'enum',
      required: false,
      description: 'Status',
      enumValues: ['A', 'I', 'T', 'L'],
    },
    {
      name: 'employeeClass',
      type: 'enum',
      required: false,
      description: 'Employee class',
      enumValues: ['FT', 'PT', 'CT', 'IN'],
    },
  ],
  defaultSyncDirection: 'INBOUND',
  defaultSyncSchedule: 'DAILY',
  supportedEntities: ['employees', 'compensation', 'job_info', 'org_info'],
  sandboxMode: true,
};

// ─── Compport Cloud SQL ──────────────────────────────────

export const COMPPORT_CLOUDSQL_TEMPLATE: ConnectorTemplate = {
  id: 'compport-cloudsql',
  name: 'Compport Cloud SQL',
  description:
    'Bi-directional sync with existing Compport PHP system via Google Cloud SQL private IP. Read employee/compensation data and write back approved changes.',
  connectorType: 'COMPPORT_CLOUDSQL',
  vendor: 'Compport',
  category: 'HRIS',
  authType: 'basic',
  authConfig: {
    fields: ['host', 'port', 'user', 'password', 'schemaName', 'tableName'],
    requiredFields: ['host', 'user', 'password', 'schemaName'],
    defaults: { port: 3306, tableName: 'employees' },
    description:
      'Cloud SQL private IP credentials. Connection via VPC peering — no SSL certificates needed.',
  },
  sourceSchema: [
    {
      name: 'employee_id',
      type: 'string',
      required: true,
      description: 'Employee identifier in Compport',
    },
    { name: 'first_name', type: 'string', required: false, description: 'First name' },
    { name: 'last_name', type: 'string', required: false, description: 'Last name' },
    { name: 'email', type: 'string', required: false, description: 'Work email' },
    { name: 'department', type: 'string', required: false, description: 'Department' },
    { name: 'base_salary', type: 'number', required: false, description: 'Base salary' },
    { name: 'total_comp', type: 'number', required: false, description: 'Total compensation' },
    { name: 'job_title', type: 'string', required: false, description: 'Job title' },
    { name: 'job_level', type: 'string', required: false, description: 'Job level/grade' },
  ],
  defaultSyncDirection: 'BIDIRECTIONAL',
  defaultSyncSchedule: 'DAILY',
  supportedEntities: ['employees', 'compensation'],
  sandboxMode: false,
};

// ─── Template Registry ──────────────────────────────────────

export const CONNECTOR_TEMPLATES: Record<string, ConnectorTemplate> = {
  workday: WORKDAY_TEMPLATE,
  bamboohr: BAMBOOHR_TEMPLATE,
  adp: ADP_TEMPLATE,
  'sap-successfactors': SAP_SF_TEMPLATE,
  'compport-cloudsql': COMPPORT_CLOUDSQL_TEMPLATE,
};

export function getConnectorTemplate(id: string): ConnectorTemplate | undefined {
  return CONNECTOR_TEMPLATES[id];
}

export function listConnectorTemplates(): ConnectorTemplate[] {
  return Object.values(CONNECTOR_TEMPLATES);
}
