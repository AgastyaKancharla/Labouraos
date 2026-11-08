-- AlterTable
ALTER TABLE "ReplacementCandidate" ADD COLUMN "interviewId" TEXT;

-- CreateIndex
CREATE INDEX "ReplacementCandidate_interviewId_idx" ON "ReplacementCandidate"("interviewId");

-- AddForeignKey
ALTER TABLE "ReplacementCandidate" ADD CONSTRAINT "ReplacementCandidate_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
