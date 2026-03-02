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
    employee_id: z.union([z.string(), z.number()]).transform(String),
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    job_title: z.string().optional().nullable(),
    job_level: z.string().optional().nullable(),
    job_family: z.string().optional().nullable(),
    hire_date: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    manager_id: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
    gender: z.string().optional().nullable(),
    ethnicity: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    base_salary: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
    total_comp: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
    currency: z.string().optional().nullable(),
    compa_ratio: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
    performance_rating: z.union([z.string(), z.number()]).transform(Number).optional().nullable(),
  })
  .passthrough(); // Allow extra columns we don't know about

export type CloudSqlEmployeeRow = z.infer<typeof CloudSqlEmployeeRowSchema>;
