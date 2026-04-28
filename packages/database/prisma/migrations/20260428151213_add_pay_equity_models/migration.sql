-- Pay Equity foundation: PayEquityRun + PayEquityRemediation
-- Each run row holds the full PayEquityAgentResult<T> envelope (output,
-- citations, methodology, confidence, warnings) so reports are reproducible
-- and auditor-defensible.

-- CreateTable
CREATE TABLE "pay_equity_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "agentType" TEXT NOT NULL,
    "methodologyName" TEXT NOT NULL,
    "methodologyVersion" TEXT NOT NULL,
    "controls" TEXT[],
    "llmModel" TEXT,
    "llmModelVersion" TEXT,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETE',
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_equity_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_equity_remediations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromValue" DECIMAL(12,2) NOT NULL,
    "toValue" DECIMAL(12,2) NOT NULL,
    "justification" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "appliedCycleId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pay_equity_remediations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pay_equity_runs_tenantId_idx" ON "pay_equity_runs"("tenantId");

-- CreateIndex
CREATE INDEX "pay_equity_runs_tenantId_agentType_idx" ON "pay_equity_runs"("tenantId", "agentType");

-- CreateIndex
CREATE INDEX "pay_equity_runs_tenantId_createdAt_idx" ON "pay_equity_runs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "pay_equity_remediations_tenantId_idx" ON "pay_equity_remediations"("tenantId");

-- CreateIndex
CREATE INDEX "pay_equity_remediations_tenantId_status_idx" ON "pay_equity_remediations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "pay_equity_remediations_runId_idx" ON "pay_equity_remediations"("runId");

-- CreateIndex
CREATE INDEX "pay_equity_remediations_employeeId_idx" ON "pay_equity_remediations"("employeeId");

-- AddForeignKey
ALTER TABLE "pay_equity_runs" ADD CONSTRAINT "pay_equity_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_equity_runs" ADD CONSTRAINT "pay_equity_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_equity_remediations" ADD CONSTRAINT "pay_equity_remediations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_equity_remediations" ADD CONSTRAINT "pay_equity_remediations_runId_fkey" FOREIGN KEY ("runId") REFERENCES "pay_equity_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
