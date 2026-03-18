-- Migration: add_missing_schema_objects
-- Adds 19 missing tables, 5 missing employee columns, 15 missing enums, and modified enum values
-- These models were added to the Prisma schema but never had migrations generated

-- ═══════════════════════════════════════
-- Missing Enums
-- ═══════════════════════════════════════
CREATE TYPE "AdHocStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'APPLIED');

CREATE TYPE "AdHocType" AS ENUM ('SPOT_BONUS', 'RETENTION_BONUS', 'MARKET_ADJUSTMENT', 'PROMOTION', 'EQUITY_ADJUSTMENT', 'OTHER');

CREATE TYPE "AttritionRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TYPE "AttritionRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TYPE "EquityGrantStatus" AS ENUM ('PENDING', 'ACTIVE', 'PARTIALLY_VESTED', 'FULLY_VESTED', 'CANCELLED', 'EXPIRED');

CREATE TYPE "EquityGrantType" AS ENUM ('RSU', 'ISO', 'NSO', 'SAR', 'PHANTOM');

CREATE TYPE "ExchangeRateSource" AS ENUM ('MANUAL', 'ECB', 'OPENEXCHANGE');

CREATE TYPE "MarketDataProvider" AS ENUM ('MANUAL', 'SURVEY', 'API');

CREATE TYPE "MarketDataSourceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

CREATE TYPE "PolicyDocumentStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');

CREATE TYPE "StatementStatus" AS ENUM ('DRAFT', 'GENERATED', 'SENT', 'FAILED');

CREATE TYPE "VestingEventStatus" AS ENUM ('SCHEDULED', 'VESTED', 'CANCELLED');

CREATE TYPE "VestingScheduleType" AS ENUM ('STANDARD_4Y_1Y_CLIFF', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM');

CREATE TYPE "WriteBackBatchStatus" AS ENUM ('PENDING_REVIEW', 'PREVIEWED', 'DRY_RUN_PASSED', 'DRY_RUN_FAILED', 'APPLYING', 'APPLIED', 'PARTIALLY_APPLIED', 'FAILED', 'ROLLED_BACK');

CREATE TYPE "WriteBackRecordStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED', 'SKIPPED');

-- ═══════════════════════════════════════
-- Modified Enums (add new values)
-- ═══════════════════════════════════════
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN';
ALTER TYPE "ConnectorType" ADD VALUE IF NOT EXISTS 'COMPPORT_CLOUDSQL';
ALTER TYPE "RecommendationStatus" ADD VALUE IF NOT EXISTS 'WRITE_QUEUED';
ALTER TYPE "RecommendationStatus" ADD VALUE IF NOT EXISTS 'WRITING';
ALTER TYPE "RecommendationStatus" ADD VALUE IF NOT EXISTS 'APPLIED_TO_COMPPORT';
ALTER TYPE "RecommendationStatus" ADD VALUE IF NOT EXISTS 'WRITE_FAILED';

-- ═══════════════════════════════════════
-- Missing Employee columns
-- ═══════════════════════════════════════
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "performanceRating" DECIMAL(3,1);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "jobFamily" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "compaRatio" DECIMAL(5,4);
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "salaryBandId" TEXT;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "jobLevelId" TEXT;

-- ═══════════════════════════════════════
-- Missing Tables
-- ═══════════════════════════════════════
-- CreateTable
CREATE TABLE "salary_bands" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobFamily" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "location" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "p10" DECIMAL(12,2) NOT NULL,
    "p25" DECIMAL(12,2) NOT NULL,
    "p50" DECIMAL(12,2) NOT NULL,
    "p75" DECIMAL(12,2) NOT NULL,
    "p90" DECIMAL(12,2) NOT NULL,
    "source" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_data_sources" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "MarketDataProvider" NOT NULL DEFAULT 'MANUAL',
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastSyncAt" TIMESTAMP(3),
    "status" "MarketDataSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merit_matrices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "matrix" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merit_matrices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_hoc_increases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "type" "AdHocType" NOT NULL,
    "reason" TEXT NOT NULL,
    "currentValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "proposedValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "status" "AdHocStatus" NOT NULL DEFAULT 'DRAFT',
    "approverUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "appliedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_hoc_increases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(10,6) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ExchangeRateSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_currencies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "supportedCurrencies" TEXT[] DEFAULT ARRAY['USD']::TEXT[],
    "displayFormat" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards_statements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfUrl" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "emailTo" TEXT,
    "status" "StatementStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rewards_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "planType" "EquityGrantType" NOT NULL,
    "totalSharesAuthorized" INTEGER NOT NULL,
    "sharesIssued" INTEGER NOT NULL DEFAULT 0,
    "sharesAvailable" INTEGER NOT NULL DEFAULT 0,
    "sharePrice" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expirationDate" TIMESTAMP(3),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equity_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equity_grants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "grantType" "EquityGrantType" NOT NULL,
    "grantDate" TIMESTAMP(3) NOT NULL,
    "totalShares" INTEGER NOT NULL,
    "vestedShares" INTEGER NOT NULL DEFAULT 0,
    "exercisedShares" INTEGER NOT NULL DEFAULT 0,
    "grantPrice" DECIMAL(12,4) NOT NULL,
    "currentPrice" DECIMAL(12,4) NOT NULL,
    "vestingScheduleType" "VestingScheduleType" NOT NULL DEFAULT 'STANDARD_4Y_1Y_CLIFF',
    "vestingStartDate" TIMESTAMP(3) NOT NULL,
    "cliffMonths" INTEGER NOT NULL DEFAULT 12,
    "vestingMonths" INTEGER NOT NULL DEFAULT 48,
    "status" "EquityGrantStatus" NOT NULL DEFAULT 'PENDING',
    "expirationDate" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equity_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vesting_events" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "vestDate" TIMESTAMP(3) NOT NULL,
    "sharesVested" INTEGER NOT NULL,
    "cumulativeVested" INTEGER NOT NULL,
    "status" "VestingEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "vestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vesting_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attrition_risk_scores" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" "AttritionRiskLevel" NOT NULL DEFAULT 'LOW',
    "factors" JSONB NOT NULL DEFAULT '{}',
    "recommendation" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "attrition_risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attrition_analysis_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "status" "AttritionRunStatus" NOT NULL DEFAULT 'PENDING',
    "totalEmployees" INTEGER NOT NULL DEFAULT 0,
    "highRiskCount" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "avgRiskScore" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attrition_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" "PolicyDocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedBy" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_families" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_levels" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobFamilyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "description" TEXT,
    "minSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "midSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "competencies" JSONB NOT NULL DEFAULT '[]',
    "nextLevelId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_ladders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tracks" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_ladders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "write_back_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "status" "WriteBackBatchStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "appliedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "skippedRecords" INTEGER NOT NULL DEFAULT 0,
    "previewSql" TEXT,
    "dryRunResult" JSONB,
    "rollbackSql" TEXT,
    "appliedByUserId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "confirmedWithPhrase" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "write_back_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "write_back_records" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT NOT NULL,
    "status" "WriteBackRecordStatus" NOT NULL DEFAULT 'PENDING',
    "cloudSqlQuery" TEXT,
    "errorMessage" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "write_back_records_pkey" PRIMARY KEY ("id")
);

-- ═══════════════════════════════════════
-- Missing Indexes
-- ═══════════════════════════════════════
CREATE INDEX "salary_bands_tenantId_idx" ON "salary_bands"("tenantId");
CREATE INDEX "salary_bands_tenantId_jobFamily_idx" ON "salary_bands"("tenantId", "jobFamily");
CREATE INDEX "salary_bands_tenantId_jobFamily_level_idx" ON "salary_bands"("tenantId", "jobFamily", "level");
CREATE INDEX "salary_bands_tenantId_jobFamily_level_location_idx" ON "salary_bands"("tenantId", "jobFamily", "level", "location");
CREATE INDEX "market_data_sources_tenantId_idx" ON "market_data_sources"("tenantId");
CREATE INDEX "market_data_sources_tenantId_provider_idx" ON "market_data_sources"("tenantId", "provider");
CREATE INDEX "merit_matrices_tenantId_idx" ON "merit_matrices"("tenantId");
CREATE INDEX "ad_hoc_increases_tenantId_idx" ON "ad_hoc_increases"("tenantId");
CREATE INDEX "ad_hoc_increases_tenantId_status_idx" ON "ad_hoc_increases"("tenantId", "status");
CREATE INDEX "ad_hoc_increases_employeeId_idx" ON "ad_hoc_increases"("employeeId");
CREATE INDEX "ad_hoc_increases_requestedById_idx" ON "ad_hoc_increases"("requestedById");
CREATE INDEX "exchange_rates_tenantId_idx" ON "exchange_rates"("tenantId");
CREATE INDEX "exchange_rates_tenantId_fromCurrency_toCurrency_idx" ON "exchange_rates"("tenantId", "fromCurrency", "toCurrency");
CREATE UNIQUE INDEX "tenant_currencies_tenantId_key" ON "tenant_currencies"("tenantId");
CREATE INDEX "tenant_currencies_tenantId_idx" ON "tenant_currencies"("tenantId");
CREATE INDEX "rewards_statements_tenantId_idx" ON "rewards_statements"("tenantId");
CREATE INDEX "rewards_statements_tenantId_employeeId_idx" ON "rewards_statements"("tenantId", "employeeId");
CREATE INDEX "rewards_statements_tenantId_status_idx" ON "rewards_statements"("tenantId", "status");
CREATE INDEX "equity_plans_tenantId_idx" ON "equity_plans"("tenantId");
CREATE INDEX "equity_plans_tenantId_isActive_idx" ON "equity_plans"("tenantId", "isActive");
CREATE INDEX "equity_grants_tenantId_idx" ON "equity_grants"("tenantId");
CREATE INDEX "equity_grants_tenantId_employeeId_idx" ON "equity_grants"("tenantId", "employeeId");
CREATE INDEX "equity_grants_tenantId_planId_idx" ON "equity_grants"("tenantId", "planId");
CREATE INDEX "equity_grants_tenantId_status_idx" ON "equity_grants"("tenantId", "status");
CREATE INDEX "equity_grants_employeeId_idx" ON "equity_grants"("employeeId");
CREATE INDEX "vesting_events_grantId_idx" ON "vesting_events"("grantId");
CREATE INDEX "vesting_events_grantId_status_idx" ON "vesting_events"("grantId", "status");
CREATE INDEX "vesting_events_grantId_vestDate_idx" ON "vesting_events"("grantId", "vestDate");
CREATE INDEX "attrition_risk_scores_tenantId_idx" ON "attrition_risk_scores"("tenantId");
CREATE INDEX "attrition_risk_scores_tenantId_employeeId_idx" ON "attrition_risk_scores"("tenantId", "employeeId");
CREATE INDEX "attrition_risk_scores_tenantId_riskLevel_idx" ON "attrition_risk_scores"("tenantId", "riskLevel");
CREATE INDEX "attrition_risk_scores_tenantId_riskScore_idx" ON "attrition_risk_scores"("tenantId", "riskScore");
CREATE INDEX "attrition_analysis_runs_tenantId_idx" ON "attrition_analysis_runs"("tenantId");
CREATE INDEX "attrition_analysis_runs_tenantId_status_idx" ON "attrition_analysis_runs"("tenantId", "status");
CREATE INDEX "attrition_analysis_runs_tenantId_createdAt_idx" ON "attrition_analysis_runs"("tenantId", "createdAt");
CREATE INDEX "policy_documents_tenantId_idx" ON "policy_documents"("tenantId");
CREATE INDEX "policy_documents_tenantId_status_idx" ON "policy_documents"("tenantId", "status");
CREATE INDEX "policy_chunks_tenantId_idx" ON "policy_chunks"("tenantId");
CREATE INDEX "policy_chunks_documentId_idx" ON "policy_chunks"("documentId");
CREATE INDEX "policy_chunks_tenantId_documentId_idx" ON "policy_chunks"("tenantId", "documentId");
CREATE INDEX "job_families_tenantId_idx" ON "job_families"("tenantId");
CREATE INDEX "job_families_tenantId_isActive_idx" ON "job_families"("tenantId", "isActive");
CREATE UNIQUE INDEX "job_families_tenantId_code_key" ON "job_families"("tenantId", "code");
CREATE UNIQUE INDEX "job_levels_nextLevelId_key" ON "job_levels"("nextLevelId");
CREATE INDEX "job_levels_tenantId_idx" ON "job_levels"("tenantId");
CREATE INDEX "job_levels_tenantId_jobFamilyId_idx" ON "job_levels"("tenantId", "jobFamilyId");
CREATE INDEX "job_levels_tenantId_grade_idx" ON "job_levels"("tenantId", "grade");
CREATE UNIQUE INDEX "job_levels_tenantId_code_key" ON "job_levels"("tenantId", "code");
CREATE INDEX "career_ladders_tenantId_idx" ON "career_ladders"("tenantId");
CREATE INDEX "career_ladders_tenantId_isActive_idx" ON "career_ladders"("tenantId", "isActive");
CREATE UNIQUE INDEX "write_back_batches_idempotencyKey_key" ON "write_back_batches"("idempotencyKey");
CREATE INDEX "write_back_batches_tenantId_idx" ON "write_back_batches"("tenantId");
CREATE INDEX "write_back_batches_tenantId_status_idx" ON "write_back_batches"("tenantId", "status");
CREATE INDEX "write_back_batches_tenantId_cycleId_idx" ON "write_back_batches"("tenantId", "cycleId");
CREATE INDEX "write_back_batches_idempotencyKey_idx" ON "write_back_batches"("idempotencyKey");
CREATE INDEX "write_back_records_batchId_idx" ON "write_back_records"("batchId");
CREATE INDEX "write_back_records_recommendationId_idx" ON "write_back_records"("recommendationId");
CREATE INDEX "write_back_records_batchId_status_idx" ON "write_back_records"("batchId", "status");
CREATE INDEX "employees_salaryBandId_idx" ON "employees"("salaryBandId");

-- ═══════════════════════════════════════
-- Missing Foreign Keys
-- ═══════════════════════════════════════
ALTER TABLE "salary_bands" ADD CONSTRAINT "salary_bands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "market_data_sources" ADD CONSTRAINT "market_data_sources_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merit_matrices" ADD CONSTRAINT "merit_matrices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_hoc_increases" ADD CONSTRAINT "ad_hoc_increases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_hoc_increases" ADD CONSTRAINT "ad_hoc_increases_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_hoc_increases" ADD CONSTRAINT "ad_hoc_increases_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ad_hoc_increases" ADD CONSTRAINT "ad_hoc_increases_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_currencies" ADD CONSTRAINT "tenant_currencies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rewards_statements" ADD CONSTRAINT "rewards_statements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rewards_statements" ADD CONSTRAINT "rewards_statements_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "equity_plans" ADD CONSTRAINT "equity_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "equity_grants" ADD CONSTRAINT "equity_grants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "equity_grants" ADD CONSTRAINT "equity_grants_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "equity_grants" ADD CONSTRAINT "equity_grants_planId_fkey" FOREIGN KEY ("planId") REFERENCES "equity_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vesting_events" ADD CONSTRAINT "vesting_events_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "equity_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attrition_risk_scores" ADD CONSTRAINT "attrition_risk_scores_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attrition_risk_scores" ADD CONSTRAINT "attrition_risk_scores_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attrition_analysis_runs" ADD CONSTRAINT "attrition_analysis_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_chunks" ADD CONSTRAINT "policy_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "policy_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_chunks" ADD CONSTRAINT "policy_chunks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_families" ADD CONSTRAINT "job_families_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_levels" ADD CONSTRAINT "job_levels_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_levels" ADD CONSTRAINT "job_levels_jobFamilyId_fkey" FOREIGN KEY ("jobFamilyId") REFERENCES "job_families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_levels" ADD CONSTRAINT "job_levels_nextLevelId_fkey" FOREIGN KEY ("nextLevelId") REFERENCES "job_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "career_ladders" ADD CONSTRAINT "career_ladders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "write_back_batches" ADD CONSTRAINT "write_back_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "write_back_batches" ADD CONSTRAINT "write_back_batches_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "comp_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "write_back_batches" ADD CONSTRAINT "write_back_batches_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "integration_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "write_back_batches" ADD CONSTRAINT "write_back_batches_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "write_back_records" ADD CONSTRAINT "write_back_records_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "write_back_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "write_back_records" ADD CONSTRAINT "write_back_records_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "comp_recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_salaryBandId_fkey" FOREIGN KEY ("salaryBandId") REFERENCES "salary_bands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_jobLevelId_fkey" FOREIGN KEY ("jobLevelId") REFERENCES "job_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- ═══════════════════════════════════════
-- Missing columns on existing tables
-- ═══════════════════════════════════════
ALTER TABLE "comp_cycles" ADD COLUMN IF NOT EXISTS "meritMatrixId" TEXT;

-- FK for comp_cycles.meritMatrixId
ALTER TABLE "comp_cycles" ADD CONSTRAINT "comp_cycles_meritMatrixId_fkey" FOREIGN KEY ("meritMatrixId") REFERENCES "merit_matrices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
