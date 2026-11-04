-- AlterTable
ALTER TABLE "JobSeekerHit" ADD COLUMN "interviewId" TEXT,
ADD COLUMN "callRecordId" TEXT,
ADD COLUMN "reversedAt" TIMESTAMP(3),
ADD COLUMN "reversedByStaffId" TEXT,
ADD COLUMN "reversalReason" TEXT;

-- CreateIndex
CREATE INDEX "JobSeekerHit_reversedAt_idx" ON "JobSeekerHit"("reversedAt");

-- AddForeignKey
ALTER TABLE "JobSeekerHit" ADD CONSTRAINT "JobSeekerHit_reversedByStaffId_fkey" FOREIGN KEY ("reversedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
