-- CreateEnum
CREATE TYPE "BenefitPlanType" AS ENUM ('MEDICAL', 'DENTAL', 'VISION', 'LIFE', 'DISABILITY');

-- CreateEnum
CREATE TYPE "BenefitTier" AS ENUM ('EMPLOYEE', 'EMPLOYEE_SPOUSE', 'EMPLOYEE_CHILDREN', 'FAMILY');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'PENDING', 'TERMINATED', 'WAIVED');

-- CreateEnum
CREATE TYPE "EnrollmentWindowStatus" AS ENUM ('UPCOMING', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "LifeEventType" AS ENUM ('MARRIAGE', 'BIRTH', 'ADOPTION', 'DIVORCE', 'LOSS_OF_COVERAGE', 'ADDRESS_CHANGE');

-- CreateEnum
CREATE TYPE "DependentRelationship" AS ENUM ('SPOUSE', 'CHILD', 'DOMESTIC_PARTNER');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('HRIS', 'PAYROLL', 'BENEFITS', 'SSO', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR', 'PENDING');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'BIDIRECTIONAL');

-- CreateEnum
CREATE TYPE "SyncSchedule" AS ENUM ('REALTIME', 'HOURLY', 'DAILY', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncLogAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'SKIP', 'ERROR');

-- CreateEnum
CREATE TYPE "ConflictStrategy" AS ENUM ('LAST_WRITE_WINS', 'MANUAL_REVIEW', 'SOURCE_PRIORITY');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('GENERATING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PolicyConversionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ComplianceScanStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ComplianceFindingSeverity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "ComplianceFindingCategory" AS ENUM ('FLSA_OVERTIME', 'PAY_EQUITY', 'POLICY_VIOLATION', 'BENEFITS_ELIGIBILITY', 'REGULATORY_GAP', 'DATA_QUALITY');

-- CreateEnum
CREATE TYPE "LetterType" AS ENUM ('OFFER', 'RAISE', 'PROMOTION', 'BONUS', 'TOTAL_COMP_SUMMARY');

-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('DRAFT', 'GENERATING', 'REVIEW', 'APPROVED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportAIAnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SimulationScenarioStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "anomaly_explanations" (
    "id" TEXT NOT NULL,
    "anomalyId" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "contributingFactors" JSONB NOT NULL DEFAULT '[]',
    "recommendedAction" TEXT NOT NULL DEFAULT 'flag',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasoning" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anomaly_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connectors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connectorType" "ConnectorType" NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'PENDING',
    "config" JSONB NOT NULL DEFAULT '{}',
    "encryptedCredentials" TEXT,
    "credentialIv" TEXT,
    "credentialTag" TEXT,
    "syncDirection" "SyncDirection" NOT NULL DEFAULT 'INBOUND',
    "syncSchedule" "SyncSchedule" NOT NULL DEFAULT 'MANUAL',
    "conflictStrategy" "ConflictStrategy" NOT NULL DEFAULT 'LAST_WRITE_WINS',
    "lastSyncAt" TIMESTAMP(3),
    "lastHealthCheck" TIMESTAMP(3),
    "healthStatus" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "entityType" TEXT NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "skippedRecords" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "action" "SyncLogAction" NOT NULL,
    "sourceData" JSONB,
    "targetData" JSONB,
    "diff" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_mappings" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceField" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "transformType" TEXT NOT NULL DEFAULT 'direct',
    "transformConfig" JSONB NOT NULL DEFAULT '{}',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "events" JSONB NOT NULL DEFAULT '[]',
    "secretHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefit_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planType" "BenefitPlanType" NOT NULL,
    "name" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "description" TEXT,
    "network" TEXT,
    "premiums" JSONB NOT NULL DEFAULT '{}',
    "deductibles" JSONB NOT NULL DEFAULT '{}',
    "outOfPocketMax" JSONB NOT NULL DEFAULT '{}',
    "copays" JSONB NOT NULL DEFAULT '{}',
    "coverageDetails" JSONB NOT NULL DEFAULT '{}',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benefit_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefit_enrollments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "tier" "BenefitTier" NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "employeePremium" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "employerPremium" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "electedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benefit_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefit_dependents" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "relationship" "DependentRelationship" NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "ssnEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benefit_dependents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_windows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "planYear" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "EnrollmentWindowStatus" NOT NULL DEFAULT 'UPCOMING',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollment_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "life_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "eventType" "LifeEventType" NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "qualifyingDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "documentation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "life_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'GENERATING',
    "queryType" TEXT,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "results" JSONB NOT NULL DEFAULT '[]',
    "chartConfig" JSONB NOT NULL DEFAULT '{}',
    "narrative" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_conversions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT,
    "fileType" TEXT,
    "policyText" TEXT NOT NULL,
    "status" "PolicyConversionStatus" NOT NULL DEFAULT 'PENDING',
    "rulesExtracted" INTEGER NOT NULL DEFAULT 0,
    "rulesAccepted" INTEGER NOT NULL DEFAULT 0,
    "rulesRejected" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_scans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ComplianceScanStatus" NOT NULL DEFAULT 'PENDING',
    "overallScore" INTEGER,
    "riskSummary" JSONB NOT NULL DEFAULT '{}',
    "scanConfig" JSONB NOT NULL DEFAULT '{}',
    "aiReport" TEXT,
    "errorMsg" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_findings" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "category" "ComplianceFindingCategory" NOT NULL,
    "severity" "ComplianceFindingSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "explanation" TEXT,
    "remediation" TEXT,
    "affectedScope" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compensation_letters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "letterType" "LetterType" NOT NULL,
    "status" "LetterStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "compData" JSONB NOT NULL DEFAULT '{}',
    "tone" TEXT NOT NULL DEFAULT 'professional',
    "language" TEXT NOT NULL DEFAULT 'en',
    "pdfUrl" TEXT,
    "batchId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "errorMsg" TEXT,
    "generatedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compensation_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_ai_analyses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "status" "ImportAIAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "qualityScore" INTEGER,
    "summary" TEXT,
    "report" JSONB NOT NULL DEFAULT '{}',
    "rawResponse" TEXT,
    "errorMsg" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_scenarios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "prompt" TEXT NOT NULL,
    "status" "SimulationScenarioStatus" NOT NULL DEFAULT 'PENDING',
    "affectedCount" INTEGER,
    "totalCostDelta" DOUBLE PRECISION,
    "budgetImpactPct" DOUBLE PRECISION,
    "results" JSONB NOT NULL DEFAULT '{}',
    "comparison" JSONB NOT NULL DEFAULT '{}',
    "response" TEXT,
    "errorMsg" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulation_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anomaly_explanations_anomalyId_key" ON "anomaly_explanations"("anomalyId");

-- CreateIndex
CREATE INDEX "anomaly_explanations_anomalyId_idx" ON "anomaly_explanations"("anomalyId");

-- CreateIndex
CREATE INDEX "integration_connectors_tenantId_idx" ON "integration_connectors"("tenantId");

-- CreateIndex
CREATE INDEX "integration_connectors_tenantId_connectorType_idx" ON "integration_connectors"("tenantId", "connectorType");

-- CreateIndex
CREATE INDEX "integration_connectors_tenantId_status_idx" ON "integration_connectors"("tenantId", "status");

-- CreateIndex
CREATE INDEX "sync_jobs_connectorId_idx" ON "sync_jobs"("connectorId");

-- CreateIndex
CREATE INDEX "sync_jobs_tenantId_idx" ON "sync_jobs"("tenantId");

-- CreateIndex
CREATE INDEX "sync_jobs_tenantId_status_idx" ON "sync_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "sync_jobs_connectorId_createdAt_idx" ON "sync_jobs"("connectorId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_logs_syncJobId_idx" ON "sync_logs"("syncJobId");

-- CreateIndex
CREATE INDEX "sync_logs_syncJobId_action_idx" ON "sync_logs"("syncJobId", "action");

-- CreateIndex
CREATE INDEX "sync_logs_syncJobId_entityId_idx" ON "sync_logs"("syncJobId", "entityId");

-- CreateIndex
CREATE INDEX "field_mappings_connectorId_idx" ON "field_mappings"("connectorId");

-- CreateIndex
CREATE INDEX "field_mappings_tenantId_idx" ON "field_mappings"("tenantId");

-- CreateIndex
CREATE INDEX "field_mappings_connectorId_enabled_idx" ON "field_mappings"("connectorId", "enabled");

-- CreateIndex
CREATE INDEX "webhook_endpoints_connectorId_idx" ON "webhook_endpoints"("connectorId");

-- CreateIndex
CREATE INDEX "webhook_endpoints_tenantId_idx" ON "webhook_endpoints"("tenantId");

-- CreateIndex
CREATE INDEX "webhook_endpoints_tenantId_isActive_idx" ON "webhook_endpoints"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "benefit_plans_tenantId_idx" ON "benefit_plans"("tenantId");

-- CreateIndex
CREATE INDEX "benefit_plans_tenantId_planType_idx" ON "benefit_plans"("tenantId", "planType");

-- CreateIndex
CREATE INDEX "benefit_plans_tenantId_isActive_idx" ON "benefit_plans"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "benefit_enrollments_tenantId_idx" ON "benefit_enrollments"("tenantId");

-- CreateIndex
CREATE INDEX "benefit_enrollments_tenantId_employeeId_idx" ON "benefit_enrollments"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "benefit_enrollments_tenantId_planId_idx" ON "benefit_enrollments"("tenantId", "planId");

-- CreateIndex
CREATE INDEX "benefit_enrollments_tenantId_status_idx" ON "benefit_enrollments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "benefit_dependents_employeeId_idx" ON "benefit_dependents"("employeeId");

-- CreateIndex
CREATE INDEX "benefit_dependents_enrollmentId_idx" ON "benefit_dependents"("enrollmentId");

-- CreateIndex
CREATE INDEX "enrollment_windows_tenantId_idx" ON "enrollment_windows"("tenantId");

-- CreateIndex
CREATE INDEX "enrollment_windows_tenantId_status_idx" ON "enrollment_windows"("tenantId", "status");

-- CreateIndex
CREATE INDEX "enrollment_windows_tenantId_planYear_idx" ON "enrollment_windows"("tenantId", "planYear");

-- CreateIndex
CREATE INDEX "life_events_tenantId_idx" ON "life_events"("tenantId");

-- CreateIndex
CREATE INDEX "life_events_tenantId_employeeId_idx" ON "life_events"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "life_events_tenantId_status_idx" ON "life_events"("tenantId", "status");

-- CreateIndex
CREATE INDEX "saved_reports_tenantId_idx" ON "saved_reports"("tenantId");

-- CreateIndex
CREATE INDEX "saved_reports_tenantId_userId_idx" ON "saved_reports"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "saved_reports_tenantId_createdAt_idx" ON "saved_reports"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "policy_conversions_tenantId_idx" ON "policy_conversions"("tenantId");

-- CreateIndex
CREATE INDEX "policy_conversions_tenantId_userId_idx" ON "policy_conversions"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "policy_conversions_tenantId_createdAt_idx" ON "policy_conversions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "compliance_scans_tenantId_idx" ON "compliance_scans"("tenantId");

-- CreateIndex
CREATE INDEX "compliance_scans_tenantId_status_idx" ON "compliance_scans"("tenantId", "status");

-- CreateIndex
CREATE INDEX "compliance_scans_tenantId_createdAt_idx" ON "compliance_scans"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "compliance_findings_scanId_idx" ON "compliance_findings"("scanId");

-- CreateIndex
CREATE INDEX "compliance_findings_scanId_severity_idx" ON "compliance_findings"("scanId", "severity");

-- CreateIndex
CREATE INDEX "compliance_findings_scanId_category_idx" ON "compliance_findings"("scanId", "category");

-- CreateIndex
CREATE INDEX "compensation_letters_tenantId_idx" ON "compensation_letters"("tenantId");

-- CreateIndex
CREATE INDEX "compensation_letters_tenantId_employeeId_idx" ON "compensation_letters"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "compensation_letters_tenantId_status_idx" ON "compensation_letters"("tenantId", "status");

-- CreateIndex
CREATE INDEX "compensation_letters_tenantId_batchId_idx" ON "compensation_letters"("tenantId", "batchId");

-- CreateIndex
CREATE INDEX "compensation_letters_tenantId_createdAt_idx" ON "compensation_letters"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "import_ai_analyses_tenantId_idx" ON "import_ai_analyses"("tenantId");

-- CreateIndex
CREATE INDEX "import_ai_analyses_importJobId_idx" ON "import_ai_analyses"("importJobId");

-- CreateIndex
CREATE INDEX "import_ai_analyses_tenantId_importJobId_idx" ON "import_ai_analyses"("tenantId", "importJobId");

-- CreateIndex
CREATE INDEX "import_ai_analyses_tenantId_createdAt_idx" ON "import_ai_analyses"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "simulation_scenarios_tenantId_idx" ON "simulation_scenarios"("tenantId");

-- CreateIndex
CREATE INDEX "simulation_scenarios_tenantId_userId_idx" ON "simulation_scenarios"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "simulation_scenarios_tenantId_status_idx" ON "simulation_scenarios"("tenantId", "status");

-- CreateIndex
CREATE INDEX "simulation_scenarios_tenantId_createdAt_idx" ON "simulation_scenarios"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "anomaly_explanations" ADD CONSTRAINT "anomaly_explanations_anomalyId_fkey" FOREIGN KEY ("anomalyId") REFERENCES "payroll_anomalies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connectors" ADD CONSTRAINT "integration_connectors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "integration_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "sync_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "integration_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "integration_connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_plans" ADD CONSTRAINT "benefit_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_enrollments" ADD CONSTRAINT "benefit_enrollments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "benefit_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_dependents" ADD CONSTRAINT "benefit_dependents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_dependents" ADD CONSTRAINT "benefit_dependents_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "benefit_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_windows" ADD CONSTRAINT "enrollment_windows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "compliance_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_letters" ADD CONSTRAINT "compensation_letters_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_ai_analyses" ADD CONSTRAINT "import_ai_analyses_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
