-- CreateTable
CREATE TABLE "copilot_conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copilot_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "copilot_conversations_tenantId_idx" ON "copilot_conversations"("tenantId");
CREATE INDEX "copilot_conversations_tenantId_userId_idx" ON "copilot_conversations"("tenantId", "userId");
CREATE INDEX "copilot_conversations_tenantId_updatedAt_idx" ON "copilot_conversations"("tenantId", "updatedAt");

-- CreateIndex
CREATE INDEX "copilot_messages_conversationId_idx" ON "copilot_messages"("conversationId");
CREATE INDEX "copilot_messages_conversationId_createdAt_idx" ON "copilot_messages"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "copilot_conversations" ADD CONSTRAINT "copilot_conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "copilot_conversations" ADD CONSTRAINT "copilot_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "copilot_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

