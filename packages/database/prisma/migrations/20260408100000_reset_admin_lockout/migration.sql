-- Reset lockout for platform admin user so they can log in
UPDATE "users"
SET "failedLoginAttempts" = 0, "lockedUntil" = NULL
WHERE "email" = 'admin@compportiq.ai';
