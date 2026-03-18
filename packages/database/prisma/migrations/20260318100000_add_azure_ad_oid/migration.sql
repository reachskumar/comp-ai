-- Add Azure AD Object ID column for SSO users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "azureAdOid" TEXT;

