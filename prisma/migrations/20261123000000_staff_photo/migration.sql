-- Staff photo: a live camera selfie taken at account setup (invite link), or at
-- the next login when missing or when the CEO asks for a new one.
ALTER TABLE "Staff" ADD COLUMN "photoStoragePath" TEXT;
ALTER TABLE "Staff" ADD COLUMN "photoTakenAt" TIMESTAMP(3);
ALTER TABLE "Staff" ADD COLUMN "photoRetakeRequestedAt" TIMESTAMP(3);
