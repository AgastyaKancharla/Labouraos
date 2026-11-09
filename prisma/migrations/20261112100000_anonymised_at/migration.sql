-- AlterTable
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "anonymisedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN IF NOT EXISTS "anonymisedAt" TIMESTAMP(3);

-- Copy existing erasedAt into anonymisedAt
UPDATE "JobSeeker" SET "anonymisedAt" = "erasedAt" WHERE "erasedAt" IS NOT NULL AND "anonymisedAt" IS NULL;
UPDATE "Business" SET "anonymisedAt" = "erasedAt" WHERE "erasedAt" IS NOT NULL AND "anonymisedAt" IS NULL;
