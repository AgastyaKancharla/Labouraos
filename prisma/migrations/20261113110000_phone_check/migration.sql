ALTER TABLE "OtpSession"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'job_seeker',
  ADD COLUMN "usedAt" TIMESTAMP(3);
