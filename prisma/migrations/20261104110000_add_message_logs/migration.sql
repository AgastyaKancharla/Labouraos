-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageLog_providerMessageId_key" ON "MessageLog"("providerMessageId");

-- CreateIndex
CREATE INDEX "MessageLog_subjectType_subjectId_idx" ON "MessageLog"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "MessageLog_status_idx" ON "MessageLog"("status");
