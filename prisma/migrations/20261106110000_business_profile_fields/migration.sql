ALTER TABLE "Business" ALTER COLUMN "area" DROP NOT NULL;

ALTER TABLE "Business"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "ownerName" TEXT,
  ADD COLUMN "additionalContactName" TEXT,
  ADD COLUMN "additionalContactPhone" TEXT,
  ADD COLUMN "businessType" TEXT,
  ADD COLUMN "employeeCount" INTEGER,
  ADD COLUMN "staffNeeded" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "licenceNumber" TEXT,
  ADD COLUMN "shopEstablishmentNumber" TEXT,
  ADD COLUMN "udyamNumber" TEXT,
  ADD COLUMN "pan" TEXT,
  ADD COLUMN "gstVerified" BOOLEAN,
  ADD COLUMN "gstLegalName" TEXT,
  ADD COLUMN "gstStatus" TEXT,
  ADD COLUMN "gstCheckedAt" TIMESTAMP(3),
  ADD COLUMN "yearsInOperation" INTEGER,
  ADD COLUMN "hiringFrequency" TEXT,
  ADD COLUMN "billingName" TEXT,
  ADD COLUMN "billingAddress" TEXT,
  ADD COLUMN "storefrontPhotoPath" TEXT,
  ADD COLUMN "storefrontPhotoHash" TEXT,
  ADD COLUMN "storefrontPhotoLive" BOOLEAN,
  ADD COLUMN "documentsStatus" TEXT,
  ADD COLUMN "verificationStatus" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedByStaffId" TEXT,
  ADD COLUMN "accountAgentId" TEXT,
  ADD COLUMN "accountAgentAssignedAt" TIMESTAMP(3),
  ADD COLUMN "leadCreatedByStaffId" TEXT,
  ADD COLUMN "leadChannel" TEXT,
  ADD COLUMN "locality" TEXT;

ALTER TABLE "Business" ALTER COLUMN "verificationStatus" SET DEFAULT 'lead';

CREATE INDEX "Business_accountAgentId_idx" ON "Business"("accountAgentId");
CREATE INDEX "Business_verificationStatus_idx" ON "Business"("verificationStatus");

ALTER TABLE "PricingPolicy"
  ADD COLUMN "duplicateBusinessRadiusMeters" INTEGER NOT NULL DEFAULT 50;
