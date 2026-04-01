/**
 * Zod schemas for validating data from Compport PHP system.
 * SECURITY: All external data is treated as untrusted and validated before processing.
 */
import { z } from 'zod';

// ─── Employee Data ─────────────────────────────────────────────

export const CompportEmployeeSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  employee_id: z.string().max(100),
  first_name: z.string().max(255),
  last_name: z.string().max(255),
  email: z.string().email().max(255),
  department: z.string().max(255).optional().nullable(),
  title: z.string().max(255).optional().nullable(),
  hire_date: z.string().optional().nullable(),
  status: z.string().max(50).optional().default('active'),
  tenant_id: z.union([z.string(), z.number()]).transform(String).optional(),
  // ─── Extended fields for AI agents (Phase 3) ─────────────
  performance_rating: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
  manager_id: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  gender: z.string().max(50).optional().nullable(),
  ethnicity: z.string().max(100).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  compa_ratio: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
  job_family: z.string().max(255).optional().nullable(),
  job_level: z.string().max(100).optional().nullable(),
  total_comp: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
  base_salary: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
  currency: z.string().max(3).optional().nullable(),
});

export type CompportEmployee = z.infer<typeof CompportEmployeeSchema>;

export const CompportEmployeeArraySchema = z.array(CompportEmployeeSchema);

// ─── Compensation Data ─────────────────────────────────────────

export const CompportCompensationSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  employee_id: z.union([z.string(), z.number()]).transform(String),
  base_salary: z.number().nonnegative(),
  currency: z.string().length(3).default('USD'),
  effective_date: z.string(),
  bonus_target: z.number().nonnegative().optional().default(0),
  equity_value: z.number().nonnegative().optional().default(0),
  pay_grade: z.string().max(50).optional().nullable(),
  tenant_id: z.union([z.string(), z.number()]).transform(String).optional(),
  // ─── Extended fields for AI agents (Phase 3) ─────────────
  total_comp: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
  compa_ratio: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
  pay_band_min: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
  pay_band_max: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
  performance_rating: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
});

export type CompportCompensation = z.infer<typeof CompportCompensationSchema>;

export const CompportCompensationArraySchema = z.array(CompportCompensationSchema);

// ─── User Data ─────────────────────────────────────────────────

export const CompportUserSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  email: z.string().email().max(255),
  name: z.string().max(255),
  role: z.string().max(50).default('viewer'),
  tenant_id: z.union([z.string(), z.number()]).transform(String).optional(),
  is_active: z.union([z.boolean(), z.number()]).transform(Boolean).default(true),
});

export type CompportUser = z.infer<typeof CompportUserSchema>;

export const CompportUserArraySchema = z.array(CompportUserSchema);

// ─── API Response Wrappers ─────────────────────────────────────

export const CompportApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown(),
  message: z.string().optional(),
  pagination: z
    .object({
      page: z.number(),
      per_page: z.number(),
      total: z.number(),
    })
    .optional(),
});

export type CompportApiResponse = z.infer<typeof CompportApiResponseSchema>;

// ─── Sync Result ───────────────────────────────────────────────

export const SyncResultSchema = z.object({
  synced: z.number(),
  skipped: z.number(),
  errors: z.number(),
  details: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['synced', 'skipped', 'error']),
      reason: z.string().optional(),
    }),
  ),
});

export type SyncResult = z.infer<typeof SyncResultSchema>;

// ─── Cloud SQL Raw Row Schema (Inbound Sync) ─────────────────

/**
 * Raw employee row from Cloud SQL (MySQL).
 * Very loose — Cloud SQL schemas vary per tenant.
 * All fields optional except employee_id.
 * The InboundSyncService applies FieldMapping transforms after validation.
 */
export const CloudSqlEmployeeRowSchema = z
  .object({
    // Identity — accept any of these as the employee identifier
    employee_id: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
    employee_code: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
    id: z.union([z.string(), z.number()]).transform(String).optional().nullable(),

    // Name fields — some schemas split first/last, others use 'name'
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    job_title: z.string().optional().nullable(),
    designation: z.union([z.string(), z.number()]).optional().nullable(),
    job_level: z.string().optional().nullable(),
    job_family: z.string().optional().nullable(),
    grade: z.union([z.string(), z.number()]).optional().nullable(),
    level: z.union([z.string(), z.number()]).optional().nullable(),
    function: z.union([z.string(), z.number()]).optional().nullable(),
    hire_date: z.union([z.string(), z.date()]).optional().nullable(),
    company_joining_date: z.union([z.string(), z.date()]).optional().nullable(),
    status: z.union([z.string(), z.number()]).optional().nullable(),
    manager_id: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
    manager_name: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
    gender: z.string().optional().nullable(),
    ethnicity: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    city: z.union([z.string(), z.number()]).optional().nullable(),
    country: z.union([z.string(), z.number()]).optional().nullable(),
    base_salary: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
    current_base_salary: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
    total_comp: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
    currency: z.union([z.string(), z.number()]).optional().nullable(),
    compa_ratio: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
    performance_rating: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
    employee_type: z.union([z.string(), z.number()]).optional().nullable(),
    employee_role: z.union([z.string(), z.number()]).optional().nullable(),
    is_manager: z.union([z.boolean(), z.number()]).optional().nullable(),

    // Hierarchy / business levels
    subfunction: z.union([z.string(), z.number()]).optional().nullable(),
    sub_subfunction: z.union([z.string(), z.number()]).optional().nullable(),
    business_level_1: z.union([z.string(), z.number()]).optional().nullable(),
    business_level_2: z.union([z.string(), z.number()]).optional().nullable(),
    business_level_3: z.union([z.string(), z.number()]).optional().nullable(),
    cost_center: z.union([z.string(), z.number()]).optional().nullable(),
    role: z.union([z.string(), z.number()]).optional().nullable(), // system role (Compport)
    education: z.union([z.string(), z.number()]).optional().nullable(),
    company_name: z.string().optional().nullable(),

    // Approver chain
    approver_1: z.string().optional().nullable(),
    approver_2: z.string().optional().nullable(),
    approver_3: z.string().optional().nullable(),
    approver_4: z.string().optional().nullable(),

    // Talent flags
    critical_talent: z.union([z.string(), z.number()]).optional().nullable(),
    critical_position: z.union([z.string(), z.number()]).optional().nullable(),
    special_category: z.union([z.string(), z.number()]).optional().nullable(),

    // Tenure and promotion
    tenure_company: z.union([z.string(), z.number()]).optional().nullable(),
    tenure_role: z.union([z.string(), z.number()]).optional().nullable(),
    recently_promoted: z.string().optional().nullable(),

    // Ratings
    rating_for_current_year: z.union([z.string(), z.number()]).optional().nullable(),
    rating_for_last_year: z.union([z.string(), z.number()]).optional().nullable(),

    // Compensation
    total_compensation: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
    current_target_bonus: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),

    // Termination
    termination_date: z.union([z.string(), z.date()]).optional().nullable(),
    termination_category: z.string().optional().nullable(),
    termination_reason: z.string().optional().nullable(),

    // Job info
    job_code: z.union([z.string(), z.number()]).optional().nullable(),
    job_name: z.string().optional().nullable(),
  })
  .passthrough() // Allow extra columns we don't know about
  .refine((data) => data.employee_id || data.employee_code || data.id, {
    message: 'At least one of employee_id, employee_code, or id is required',
  });

export type CloudSqlEmployeeRow = z.infer<typeof CloudSqlEmployeeRowSchema>;
