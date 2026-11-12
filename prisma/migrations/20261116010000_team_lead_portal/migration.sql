-- Team Lead portal: call quality scores (a minimal checklist) and the Team
-- Lead's checks of registrations and shop visits. Coaching notes use the
-- Manager portal's StaffCoachingNote table (one place for every note).
CREATE TABLE "CallQualityScore" (
  "id" TEXT NOT NULL,
  "callRecordId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "scoredByStaffId" TEXT NOT NULL,
  "checks" JSONB NOT NULL,
  "score" INTEGER NOT NULL,
  "note" TEXT,
  "flagged" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallQualityScore_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CallQualityScore_callRecordId_key" ON "CallQualityScore"("callRecordId");
CREATE INDEX "CallQualityScore_staffId_createdAt_idx" ON "CallQualityScore"("staffId", "createdAt");
CREATE INDEX "CallQualityScore_scoredByStaffId_idx" ON "CallQualityScore"("scoredByStaffId");
ALTER TABLE "CallQualityScore" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "TeamLeadCheck" (
  "id" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "verdict" TEXT NOT NULL,
  "note" TEXT,
  "flagId" TEXT,
  "checkedByStaffId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamLeadCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TeamLeadCheck_subjectType_subjectId_idx" ON "TeamLeadCheck"("subjectType", "subjectId");
CREATE INDEX "TeamLeadCheck_checkedByStaffId_createdAt_idx" ON "TeamLeadCheck"("checkedByStaffId", "createdAt");
ALTER TABLE "TeamLeadCheck" ENABLE ROW LEVEL SECURITY;
