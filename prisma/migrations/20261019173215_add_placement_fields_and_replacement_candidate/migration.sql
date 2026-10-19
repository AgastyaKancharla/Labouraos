-- AlterTable
ALTER TABLE "Placement" ADD COLUMN     "agreedSalary" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clockPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "clockPausedAt" TIMESTAMP(3),
ADD COLUMN     "dropoutReportedAt" TIMESTAMP(3),
ADD COLUMN     "eligibility" TEXT,
ALTER COLUMN "status" SET DEFAULT 'offered';

-- CreateTable
CREATE TABLE "ReplacementCandidate" (
    "id" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "jobSeekerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offered',
    "rejectionReason" TEXT,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplacementCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplacementCandidate_placementId_idx" ON "ReplacementCandidate"("placementId");

-- CreateIndex
CREATE INDEX "ReplacementCandidate_jobSeekerId_idx" ON "ReplacementCandidate"("jobSeekerId");

-- AddForeignKey
ALTER TABLE "ReplacementCandidate" ADD CONSTRAINT "ReplacementCandidate_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementCandidate" ADD CONSTRAINT "ReplacementCandidate_jobSeekerId_fkey" FOREIGN KEY ("jobSeekerId") REFERENCES "JobSeeker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
