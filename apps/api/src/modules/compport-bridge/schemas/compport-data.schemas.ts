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

