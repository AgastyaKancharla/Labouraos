-- DropForeignKey / DropIndex for JobSeeker
DROP INDEX IF EXISTS "JobSeeker_tradeSkill_idx";

-- AlterTable JobSeeker: drop tradeSkill, kycStatus, kycReference, erasedAt
ALTER TABLE "JobSeeker" DROP COLUMN IF EXISTS "tradeSkill";
ALTER TABLE "JobSeeker" DROP COLUMN IF EXISTS "kycStatus";
ALTER TABLE "JobSeeker" DROP COLUMN IF EXISTS "kycReference";
ALTER TABLE "JobSeeker" DROP COLUMN IF EXISTS "erasedAt";

-- DropIndex & CreateIndex for Business
DROP INDEX IF EXISTS "Business_city_area_idx";
CREATE INDEX IF NOT EXISTS "Business_city_idx" ON "Business"("city");

-- AlterTable Business: drop area, contactName, selfieUrl, selfieHash, erasedAt
ALTER TABLE "Business" DROP COLUMN IF EXISTS "area";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "contactName";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "selfieUrl";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "selfieHash";
ALTER TABLE "Business" DROP COLUMN IF EXISTS "erasedAt";

-- AlterTable Staff: drop area, registeredDeviceId
ALTER TABLE "Staff" DROP COLUMN IF EXISTS "area";
ALTER TABLE "Staff" DROP COLUMN IF EXISTS "registeredDeviceId";

-- DropIndex for Placement
DROP INDEX IF EXISTS "Placement_status_eligibility_idx";

-- AlterTable Placement: drop clockPaused, clockPausedAt, replacementRejectionCount, eligibility
ALTER TABLE "Placement" DROP COLUMN IF EXISTS "clockPaused";
ALTER TABLE "Placement" DROP COLUMN IF EXISTS "clockPausedAt";
ALTER TABLE "Placement" DROP COLUMN IF EXISTS "replacementRejectionCount";
ALTER TABLE "Placement" DROP COLUMN IF EXISTS "eligibility";

-- AlterTable Vacancy: drop offeredSalary
ALTER TABLE "Vacancy" DROP COLUMN IF EXISTS "offeredSalary";

-- AlterTable Payment: drop payoutAttempts
ALTER TABLE "Payment" DROP COLUMN IF EXISTS "payoutAttempts";
