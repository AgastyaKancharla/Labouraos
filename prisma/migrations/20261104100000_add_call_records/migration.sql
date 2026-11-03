-- CreateTable
CREATE TABLE "CallRecord" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerCallId" TEXT NOT NULL,
    "direction" TEXT,
    "staffId" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "purpose" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "providerStatus" TEXT NOT NULL,
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "recordingStoragePath" TEXT,
    "recordingDeletedAt" TIMESTAMP(3),
    "announcementPlayed" BOOLEAN NOT NULL DEFAULT false,
    "agentOutcome" TEXT,
    "agentOutcomeReason" TEXT,
    "agentOutcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallRecord_code_key" ON "CallRecord"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CallRecord_provider_providerCallId_key" ON "CallRecord"("provider", "providerCallId");

-- CreateIndex
CREATE INDEX "CallRecord_staffId_idx" ON "CallRecord"("staffId");

-- CreateIndex
CREATE INDEX "CallRecord_subjectType_subjectId_idx" ON "CallRecord"("subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
