-- CreateTable
CREATE TABLE "ReplacementClaim" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "workerLeftOn" TIMESTAMP(3) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedWithinDeadline" BOOLEAN NOT NULL,
    "feePaidInFull" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "evidencePaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exitCallRecordId" TEXT,
    "callRecordId" TEXT NOT NULL,
    "decision" TEXT,
    "decisionReason" TEXT,
    "decidedByStaffId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionDueAt" TIMESTAMP(3) NOT NULL,
    "overruledByStaffId" TEXT,
    "overruleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplacementClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReplacementClaim_code_key" ON "ReplacementClaim"("code");

-- CreateIndex
CREATE INDEX "ReplacementClaim_placementId_idx" ON "ReplacementClaim"("placementId");

-- CreateIndex
CREATE INDEX "ReplacementClaim_decision_idx" ON "ReplacementClaim"("decision");

-- CreateIndex
CREATE INDEX "ReplacementClaim_decisionDueAt_idx" ON "ReplacementClaim"("decisionDueAt");

-- CreateIndex
CREATE INDEX "ReplacementClaim_decidedByStaffId_idx" ON "ReplacementClaim"("decidedByStaffId");

-- CreateIndex
CREATE INDEX "ReplacementClaim_overruledByStaffId_idx" ON "ReplacementClaim"("overruledByStaffId");

-- CreateIndex
CREATE INDEX "ReplacementClaim_callRecordId_idx" ON "ReplacementClaim"("callRecordId");

-- CreateIndex
CREATE INDEX "ReplacementClaim_exitCallRecordId_idx" ON "ReplacementClaim"("exitCallRecordId");

-- AddForeignKey
ALTER TABLE "ReplacementClaim" ADD CONSTRAINT "ReplacementClaim_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementClaim" ADD CONSTRAINT "ReplacementClaim_exitCallRecordId_fkey" FOREIGN KEY ("exitCallRecordId") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementClaim" ADD CONSTRAINT "ReplacementClaim_callRecordId_fkey" FOREIGN KEY ("callRecordId") REFERENCES "CallRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementClaim" ADD CONSTRAINT "ReplacementClaim_decidedByStaffId_fkey" FOREIGN KEY ("decidedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementClaim" ADD CONSTRAINT "ReplacementClaim_overruledByStaffId_fkey" FOREIGN KEY ("overruledByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
