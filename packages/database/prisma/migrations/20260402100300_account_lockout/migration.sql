-- =============================================================================
-- Account lockout — lock after 5 failed attempts for 30 minutes
-- =============================================================================

ALTER TABLE "users" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "lockedUntil" TIMESTAMP(3);

