-- Reset platform admin password to ChangeMe123!@# and clear lockout.
-- Uses raw SQL to bypass RLS on users table.
UPDATE "users"
SET "passwordHash" = '$2b$12$5t1cIh.9Kwa9n/CeHjtrEeioGHxQaPNNgEfMh6GI3jZLivVOwFB1O',
    "failedLoginAttempts" = 0,
    "lockedUntil" = NULL
WHERE "email" = 'admin@compportiq.ai';
