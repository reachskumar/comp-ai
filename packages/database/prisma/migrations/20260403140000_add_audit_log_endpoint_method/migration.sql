-- AlterTable: Add missing endpoint and method columns to audit_logs
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "endpoint" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "method" TEXT;

