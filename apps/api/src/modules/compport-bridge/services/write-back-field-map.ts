/**
 * Write-Back Field Map — Comprehensive mapping of all writeable fields
 * from CompportIQ to Compport Cloud SQL `login_user` table.
 *
 * Based on the legacy Compport PHP system's Rule_model::upd_emps_sal_data_in_core()
 * which writes 150+ fields during salary rule closure.
 *
 * Field categories:
 * - SALARY: Core salary fields (base, allowances, total comp)
 * - HISTORY: Salary history cascade (5 levels)
 * - DATE_HISTORY: Effective date history cascade (5 levels)
 * - DEMOGRAPHIC: Employee demographics (city, grade, level, etc.)
 * - RATING: Performance rating fields
 * - PROMOTION: Promotion-related fields
 * - BONUS: Bonus-related fields
 * - META: Metadata fields (updatedon, updatedby, etc.)
 */

export type WriteBackFieldCategory =
  | 'SALARY'
  | 'HISTORY'
  | 'DATE_HISTORY'
  | 'DEMOGRAPHIC'
  | 'RATING'
  | 'PROMOTION'
  | 'BONUS'
  | 'META';

export interface WriteBackFieldDef {
  /** Cloud SQL column name in login_user */
  column: string;
  /** Field category for grouping and validation */
  category: WriteBackFieldCategory;
  /** Human-readable description */
  description: string;
  /** Whether this field requires history cascade logic */
  cascadeField?: boolean;
}

// ─── Core Salary Fields ──────────────────────────────────────────
const SALARY_FIELDS: WriteBackFieldDef[] = [
  { column: 'current_base_salary', category: 'SALARY', description: 'Base salary amount' },
  { column: 'current_target_bonus', category: 'SALARY', description: 'Target bonus amount' },
  { column: 'total_compensation', category: 'SALARY', description: 'Total compensation' },
  {
    column: 'increment_applied_on',
    category: 'SALARY',
    description: 'Revised fixed salary (increment base)',
  },
  // Allowance fields 1-70
  ...Array.from({ length: 70 }, (_, i) => ({
    column: `allowance_${i + 1}`,
    category: 'SALARY' as WriteBackFieldCategory,
    description: `Configurable allowance field ${i + 1}`,
  })),
];

// ─── Salary History Cascade (5 levels) ───────────────────────────
const HISTORY_FIELDS: WriteBackFieldDef[] = [
  {
    column: 'total_salary_after_last_increase',
    category: 'HISTORY',
    description: 'Total comp after last increase',
    cascadeField: true,
  },
  {
    column: 'total_salary_after_2nd_last_increase',
    category: 'HISTORY',
    description: 'Total comp after 2nd last increase',
    cascadeField: true,
  },
  {
    column: 'total_salary_after_3rd_last_increase',
    category: 'HISTORY',
    description: 'Total comp after 3rd last increase',
    cascadeField: true,
  },
  {
    column: 'total_salary_after_4th_last_increase',
    category: 'HISTORY',
    description: 'Total comp after 4th last increase',
    cascadeField: true,
  },
  {
    column: 'total_salary_after_5th_last_increase',
    category: 'HISTORY',
    description: 'Total comp after 5th last increase',
    cascadeField: true,
  },
];

// ─── Date History Cascade (5 levels) ─────────────────────────────
const DATE_HISTORY_FIELDS: WriteBackFieldDef[] = [
  {
    column: 'effective_date_of_current_salary_increase',
    category: 'DATE_HISTORY',
    description: 'Current salary increase effective date',
    cascadeField: true,
  },
  {
    column: 'effective_date_of_last_salary_increase',
    category: 'DATE_HISTORY',
    description: 'Last salary increase effective date',
    cascadeField: true,
  },
  {
    column: 'effective_date_of_2nd_last_salary_increase',
    category: 'DATE_HISTORY',
    description: '2nd last salary increase effective date',
    cascadeField: true,
  },
  {
    column: 'effective_date_of_3rd_last_salary_increase',
    category: 'DATE_HISTORY',
    description: '3rd last salary increase effective date',
    cascadeField: true,
  },
  {
    column: 'effective_date_of_4th_last_salary_increase',
    category: 'DATE_HISTORY',
    description: '4th last salary increase effective date',
    cascadeField: true,
  },
  {
    column: 'effective_date_of_5th_last_salary_increase',
    category: 'DATE_HISTORY',
    description: '5th last salary increase effective date',
    cascadeField: true,
  },
];

// ─── Demographic Fields ──────────────────────────────────────────
const DEMOGRAPHIC_FIELDS: WriteBackFieldDef[] = [
  { column: 'city', category: 'DEMOGRAPHIC', description: 'Employee city' },
  { column: 'designation', category: 'DEMOGRAPHIC', description: 'Job designation' },
  { column: 'grade', category: 'DEMOGRAPHIC', description: 'Salary grade' },
  { column: 'level', category: 'DEMOGRAPHIC', description: 'Job level' },
  { column: 'sub_subfunction', category: 'DEMOGRAPHIC', description: 'Sub-sub-function' },
  { column: 'critical_talent', category: 'DEMOGRAPHIC', description: 'Critical talent flag' },
  { column: 'employee_type', category: 'DEMOGRAPHIC', description: 'Employee type' },
  { column: 'other_data_9', category: 'DEMOGRAPHIC', description: 'Custom data field 9' },
];

// ─── Rating & Promotion Fields ───────────────────────────────────
const RATING_FIELDS: WriteBackFieldDef[] = [
  {
    column: 'rating_for_current_year',
    category: 'RATING',
    description: 'Performance rating (current year)',
  },
];

const PROMOTION_FIELDS: WriteBackFieldDef[] = [
  {
    column: 'promoted_in_2_yrs',
    category: 'PROMOTION',
    description: 'Promotion date (if promoted)',
  },
];

// ─── Bonus Fields (for bonus rule closure) ───────────────────────
const BONUS_FIELDS: WriteBackFieldDef[] = [
  {
    column: 'assignment_based_salary',
    category: 'BONUS',
    description: 'Pro-rated assignment salary',
  },
];

// ─── Metadata Fields ─────────────────────────────────────────────
const META_FIELDS: WriteBackFieldDef[] = [
  { column: 'updatedon', category: 'META', description: 'Last update timestamp' },
  { column: 'updatedby', category: 'META', description: 'Updated by user ID' },
  { column: 'updatedby_proxy', category: 'META', description: 'Updated by proxy user ID' },
];

/** All writeable fields combined */
export const ALL_WRITEABLE_FIELDS: WriteBackFieldDef[] = [
  ...SALARY_FIELDS,
  ...HISTORY_FIELDS,
  ...DATE_HISTORY_FIELDS,
  ...DEMOGRAPHIC_FIELDS,
  ...RATING_FIELDS,
  ...PROMOTION_FIELDS,
  ...BONUS_FIELDS,
  ...META_FIELDS,
];

/** Set of all writeable column names for fast validation */
export const WRITEABLE_COLUMN_SET = new Set(ALL_WRITEABLE_FIELDS.map((f) => f.column));

/** Legacy 4-field compatibility set */
export const LEGACY_WRITEABLE_FIELDS = new Set([
  'base_salary',
  'total_comp',
  'job_title',
  'job_level',
]);

/** Map legacy field names → actual login_user column names */
export const LEGACY_FIELD_ALIAS: Record<string, string> = {
  base_salary: 'current_base_salary',
  total_comp: 'total_compensation',
  job_title: 'designation',
  job_level: 'level',
};

/**
 * Validate a field name is writeable. Supports both legacy 4-field names
 * and the full 150+ field set.
 */
export function isWriteableField(fieldName: string): boolean {
  return WRITEABLE_COLUMN_SET.has(fieldName) || LEGACY_WRITEABLE_FIELDS.has(fieldName);
}

/**
 * Resolve a field name to its actual Cloud SQL column name.
 * Maps legacy aliases (e.g., 'base_salary' → 'current_base_salary').
 */
export function resolveColumnName(fieldName: string): string {
  return LEGACY_FIELD_ALIAS[fieldName] ?? fieldName;
}

/** Get all fields in a specific category */
export function getFieldsByCategory(category: WriteBackFieldCategory): WriteBackFieldDef[] {
  return ALL_WRITEABLE_FIELDS.filter((f) => f.category === category);
}

/** Multi-table write targets beyond login_user */
export const WRITE_BACK_TABLES = {
  LOGIN_USER: 'login_user',
  LOGIN_USER_HISTORY: 'login_user_history',
  EMPLOYEE_SALARY_DETAILS: 'employee_salary_details',
  SALARY_RULE_USERS_DTLS: 'salary_rule_users_dtls',
  EMPLOYEE_BONUS_DETAILS: 'employee_bonus_details',
  BONUS_RULE_USERS_DTLS: 'bonus_rule_users_dtls',
} as const;

export type WriteBackTable = (typeof WRITE_BACK_TABLES)[keyof typeof WRITE_BACK_TABLES];
