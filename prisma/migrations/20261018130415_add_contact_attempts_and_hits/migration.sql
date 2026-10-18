-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reactivation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ContactAttempt" (
    "id" TEXT NOT NULL,
    "jobSeekerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "hitId" TEXT,
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSeekerHit" (
    "id" TEXT NOT NULL,
    "jobSeekerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "recordedBy" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobSeekerHit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactAttempt_jobSeekerId_idx" ON "ContactAttempt"("jobSeekerId");

-- CreateIndex
CREATE INDEX "ContactAttempt_hitId_idx" ON "ContactAttempt"("hitId");

-- CreateIndex
CREATE INDEX "ContactAttempt_attemptedAt_idx" ON "ContactAttempt"("attemptedAt");

-- CreateIndex
CREATE INDEX "JobSeekerHit_jobSeekerId_idx" ON "JobSeekerHit"("jobSeekerId");

-- CreateIndex
CREATE INDEX "JobSeekerHit_recordedAt_idx" ON "JobSeekerHit"("recordedAt");

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_jobSeekerId_fkey" FOREIGN KEY ("jobSeekerId") REFERENCES "JobSeeker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_hitId_fkey" FOREIGN KEY ("hitId") REFERENCES "JobSeekerHit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSeekerHit" ADD CONSTRAINT "JobSeekerHit_jobSeekerId_fkey" FOREIGN KEY ("jobSeekerId") REFERENCES "JobSeeker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
