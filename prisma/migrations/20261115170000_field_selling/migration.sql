-- Laboura Field: on-the-spot matching and selling (guide, "Confirming in the shop", decided 9 Nov).
ALTER TABLE "Interview" ADD COLUMN "interviewType" TEXT,
  ADD COLUMN "agentWillAttend" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "handedToOwnerAt" TIMESTAMP(3),
  ADD COLUMN "resultRecordedByStaffId" TEXT,
  ADD COLUMN "phoneInterviewDialledAt" TIMESTAMP(3),
  ADD COLUMN "phoneInterviewCallRecordId" TEXT;

ALTER TABLE "Placement" ADD COLUMN "joiningNoShowReportedAt" TIMESTAMP(3),
  ADD COLUMN "joiningMovedCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "OwnerFavourite" (
    "id" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "jobSeekerId" TEXT NOT NULL,
    "markedByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OwnerFavourite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OwnerFavourite_vacancyId_jobSeekerId_key" ON "OwnerFavourite"("vacancyId", "jobSeekerId");
CREATE INDEX "OwnerFavourite_jobSeekerId_idx" ON "OwnerFavourite"("jobSeekerId");
ALTER TABLE "OwnerFavourite" ADD CONSTRAINT "OwnerFavourite_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OwnerFavourite" ENABLE ROW LEVEL SECURITY;
