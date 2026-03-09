-- Add EDGE Pay Equity fields to employees
ALTER TABLE "employees" ADD COLUMN "gender" TEXT;
ALTER TABLE "employees" ADD COLUMN "dateOfBirth" TIMESTAMP(3);
ALTER TABLE "employees" ADD COLUMN "functionType" TEXT;
ALTER TABLE "employees" ADD COLUMN "responsibilityLevel" TEXT;
ALTER TABLE "employees" ADD COLUMN "isPeopleManager" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "employees" ADD COLUMN "ftePercent" DECIMAL(5,2) NOT NULL DEFAULT 100;
ALTER TABLE "employees" ADD COLUMN "totalCashComp" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Pay Equity Reports
CREATE TABLE "pay_equity_reports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'STANDARD',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "compType" TEXT NOT NULL DEFAULT 'SALARY',
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "populationSize" INTEGER NOT NULL DEFAULT 0,
    "threshold" DECIMAL(4,2) NOT NULL DEFAULT 5.0,
    "genderEffect" DECIMAL(6,3),
    "isCompliant" BOOLEAN,
    "rSquared" DECIMAL(5,4),
    "adjustedRSquared" DECIMAL(5,4),
    "fStatistic" DECIMAL(10,4),
    "coefficients" JSONB NOT NULL DEFAULT '{}',
    "narrative" TEXT,
    "errorMessage" TEXT,
    "createdById" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pay_equity_reports_pkey" PRIMARY KEY ("id")
);

-- Pay Equity Dimensions (per-department/function/level breakdowns)
CREATE TABLE "pay_equity_dimensions" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "dimensionType" TEXT NOT NULL DEFAULT 'OVERALL',
    "populationSize" INTEGER NOT NULL DEFAULT 0,
    "maleCount" INTEGER NOT NULL DEFAULT 0,
    "femaleCount" INTEGER NOT NULL DEFAULT 0,
    "genderEffect" DECIMAL(6,3),
    "isCompliant" BOOLEAN,
    "coefficients" JSONB NOT NULL DEFAULT '{}',
    "rSquared" DECIMAL(5,4),
    "pValue" DECIMAL(8,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_equity_dimensions_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "pay_equity_reports_tenantId_idx" ON "pay_equity_reports"("tenantId");
CREATE INDEX "pay_equity_reports_tenantId_status_idx" ON "pay_equity_reports"("tenantId", "status");
CREATE INDEX "pay_equity_reports_tenantId_createdAt_idx" ON "pay_equity_reports"("tenantId", "createdAt");
CREATE INDEX "pay_equity_dimensions_reportId_idx" ON "pay_equity_dimensions"("reportId");
CREATE INDEX "pay_equity_dimensions_reportId_dimensionType_idx" ON "pay_equity_dimensions"("reportId", "dimensionType");

-- Foreign keys
ALTER TABLE "pay_equity_reports" ADD CONSTRAINT "pay_equity_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pay_equity_dimensions" ADD CONSTRAINT "pay_equity_dimensions_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "pay_equity_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

