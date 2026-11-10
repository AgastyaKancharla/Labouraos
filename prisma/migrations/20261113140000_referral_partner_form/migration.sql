ALTER TABLE "Referral"
  ADD COLUMN "whatsappPhone" TEXT,
  ADD COLUMN "language" TEXT,
  ADD COLUMN "individualRole" TEXT,
  ADD COLUMN "businessId" TEXT,
  ADD COLUMN "partnerBusinessType" TEXT,
  ADD COLUMN "partnerBusinessName" TEXT,
  ADD COLUMN "locality" TEXT,
  ADD COLUMN "pincode" TEXT,
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "heardFrom" TEXT,
  ADD COLUMN "photoStoragePath" TEXT,
  ADD COLUMN "photoTakenAt" TIMESTAMP(3);

CREATE INDEX "Referral_businessId_idx" ON "Referral"("businessId");
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReferralIdentityVerification" (
  "id" TEXT NOT NULL,
  "referralId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "vendor" TEXT NOT NULL,
  "vendorReference" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "last4" TEXT,
  "nameMatches" BOOLEAN,
  "isAdult" BOOLEAN,
  "verifiedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReferralIdentityVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReferralIdentityVerification_referralId_createdAt_idx"
  ON "ReferralIdentityVerification"("referralId", "createdAt");
CREATE INDEX "ReferralIdentityVerification_status_idx"
  ON "ReferralIdentityVerification"("status");
ALTER TABLE "ReferralIdentityVerification" ADD CONSTRAINT "ReferralIdentityVerification_referralId_fkey"
  FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
