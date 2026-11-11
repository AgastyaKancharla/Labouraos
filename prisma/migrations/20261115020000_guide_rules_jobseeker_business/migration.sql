-- Master Guide rules for job seekers, businesses and hits (build w1-rules).
-- Same-visit selling: in-person onboarded businesses and the Team Lead's pause.
ALTER TABLE "Business" ADD COLUMN "inPersonOnboardedAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "pausedByStaffId" TEXT;
ALTER TABLE "Business" ADD COLUMN "pauseReason" TEXT;

-- A job seeker who found a job on his own: profile closed, no ₹499 refund.
ALTER TABLE "JobSeeker" ADD COLUMN "foundOwnJobAt" TIMESTAMP(3);

-- Paying ₹499 again resets the guarantee: hits from the earlier cycle are superseded.
ALTER TABLE "JobSeekerHit" ADD COLUMN "supersededAt" TIMESTAMP(3);
CREATE INDEX "JobSeekerHit_jobSeekerId_supersededAt_idx" ON "JobSeekerHit"("jobSeekerId", "supersededAt");
