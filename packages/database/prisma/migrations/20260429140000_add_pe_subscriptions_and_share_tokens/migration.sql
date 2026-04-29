-- Phase 3.7 + 6.4 — scheduled report delivery + CHRO daily digest.
-- Phase 5.5 — external auditor read-only share tokens.

-- CreateTable
CREATE TABLE "pe_report_subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slackWebhook" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pe_report_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pe_share_tokens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),

    CONSTRAINT "pe_share_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pe_report_subscriptions_tenantId_idx" ON "pe_report_subscriptions"("tenantId");
CREATE INDEX "pe_report_subscriptions_tenantId_active_idx" ON "pe_report_subscriptions"("tenantId", "active");
CREATE INDEX "pe_report_subscriptions_nextRunAt_idx" ON "pe_report_subscriptions"("nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "pe_share_tokens_token_key" ON "pe_share_tokens"("token");
CREATE INDEX "pe_share_tokens_tenantId_idx" ON "pe_share_tokens"("tenantId");
CREATE INDEX "pe_share_tokens_token_idx" ON "pe_share_tokens"("token");
CREATE INDEX "pe_share_tokens_runId_idx" ON "pe_share_tokens"("runId");

-- AddForeignKey
ALTER TABLE "pe_report_subscriptions" ADD CONSTRAINT "pe_report_subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pe_share_tokens" ADD CONSTRAINT "pe_share_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
