ALTER TABLE "PricingPolicy"
  ADD COLUMN "interviewResultCloseHours" INTEGER NOT NULL DEFAULT 48;

CREATE SEQUENCE IF NOT EXISTS "seq_id_int" START WITH 1;

CREATE TABLE "Interview" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "vacancyId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "jobSeekerId" TEXT NOT NULL,
  "vacancyInterviewSlotId" TEXT NOT NULL,
  "slotStartsAt" TIMESTAMP(3) NOT NULL,
  "slotEndsAt" TIMESTAMP(3) NOT NULL,
  "proposedByStaffId" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "suitabilitySnapshot" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'offered',
  "offerMessageLogIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "offerSentAt" TIMESTAMP(3) NOT NULL,
  "replyDueAt" TIMESTAMP(3) NOT NULL,
  "candidateRespondedAt" TIMESTAMP(3),
  "businessDetailsSentAt" TIMESTAMP(3),
  "agentAttendanceRequired" BOOLEAN NOT NULL DEFAULT false,
  "attendanceVisitId" TEXT,
  "result" TEXT,
  "resultReason" TEXT,
  "resultOtpRequestId" TEXT,
  "resultDueAt" TIMESTAMP(3) NOT NULL,
  "resultRecordedAt" TIMESTAMP(3),
  "candidateCheckAnswer" TEXT,
  "candidateCheckAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Interview_code_key" ON "Interview"("code");
CREATE INDEX "Interview_vacancyId_status_idx" ON "Interview"("vacancyId", "status");
CREATE INDEX "Interview_businessId_jobSeekerId_status_idx" ON "Interview"("businessId", "jobSeekerId", "status");
CREATE INDEX "Interview_jobSeekerId_status_idx" ON "Interview"("jobSeekerId", "status");
CREATE INDEX "Interview_vacancyInterviewSlotId_status_idx" ON "Interview"("vacancyInterviewSlotId", "status");
CREATE INDEX "Interview_replyDueAt_status_idx" ON "Interview"("replyDueAt", "status");
CREATE INDEX "Interview_resultDueAt_status_idx" ON "Interview"("resultDueAt", "status");

ALTER TABLE "Interview" ADD CONSTRAINT "Interview_vacancyId_fkey"
  FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_jobSeekerId_fkey"
  FOREIGN KEY ("jobSeekerId") REFERENCES "JobSeeker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_vacancyInterviewSlotId_fkey"
  FOREIGN KEY ("vacancyInterviewSlotId") REFERENCES "VacancyInterviewSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_proposedByStaffId_fkey"
  FOREIGN KEY ("proposedByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
