-- Aadhaar verification (Master Guide, 14 Nov; rev 154): an in-house check of
-- UIDAI's Secure QR code; other government IDs (PAN, driving licence, voter
-- ID) checked by the Team Lead from a live photo of the card. No verification
-- company, no DigiLocker, no outside ID provider.

-- What each check keeps besides verified yes/no, the method and the time.
ALTER TABLE "IdentityVerification" ADD COLUMN "phoneLinked" TEXT;
ALTER TABLE "IdentityVerification" ADD COLUMN "qrIssuedAt" TIMESTAMP(3);
ALTER TABLE "IdentityVerification" ADD COLUMN "consentId" TEXT;
ALTER TABLE "IdentityVerification" ADD COLUMN "under18LiftedAt" TIMESTAMP(3);
ALTER TABLE "IdentityVerification" ADD COLUMN "under18LiftedByStaffId" TEXT;
ALTER TABLE "IdentityVerification" ADD COLUMN "under18LiftReason" TEXT;
ALTER TABLE "IdentityVerification" ALTER COLUMN "vendorReference" DROP NOT NULL;
ALTER TABLE "ReferralIdentityVerification" ADD COLUMN "phoneLinked" TEXT;
ALTER TABLE "ReferralIdentityVerification" ADD COLUMN "qrIssuedAt" TIMESTAMP(3);
ALTER TABLE "ReferralIdentityVerification" ADD COLUMN "consentId" TEXT;
ALTER TABLE "ReferralIdentityVerification" ADD COLUMN "under18LiftedAt" TIMESTAMP(3);
ALTER TABLE "ReferralIdentityVerification" ADD COLUMN "under18LiftedByStaffId" TEXT;
ALTER TABLE "ReferralIdentityVerification" ADD COLUMN "under18LiftReason" TEXT;
ALTER TABLE "ReferralIdentityVerification" ALTER COLUMN "vendorReference" DROP NOT NULL;

-- Checks made before 14 Nov through the old Aadhaar route keep their result;
-- they are relabelled so nothing refers to that route any more.
UPDATE "IdentityVerification" SET "method" = 'aadhaar_older_check' WHERE "method" = 'digilocker';
UPDATE "IdentityVerification" SET "vendor" = 'older_check' WHERE "vendor" = 'digilocker';
UPDATE "ReferralIdentityVerification" SET "method" = 'aadhaar_older_check' WHERE "method" = 'digilocker';
UPDATE "ReferralIdentityVerification" SET "vendor" = 'older_check' WHERE "vendor" = 'digilocker';

-- The outside provider's outage tracking is gone with the provider.
DROP TABLE IF EXISTS "KycRecoveryRequest";
DROP TABLE IF EXISTS "KycServiceState";

-- Name, date of birth, gender, area and pincode from a QR that passed, the QR
-- photo, or the live photo of another ID card (until the Team Lead's decision,
-- 30 days at most).
CREATE TABLE "IdCheckDetail" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "nameOnId" TEXT,
    "dateOfBirth" TEXT,
    "gender" TEXT,
    "area" TEXT,
    "pincode" TEXT,
    "photoPath" TEXT,
    "photoExpiresAt" TIMESTAMP(3),
    "photoDeletedAt" TIMESTAMP(3),
    "photoDeletedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdCheckDetail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdCheckDetail_verificationId_key" ON "IdCheckDetail"("verificationId");
CREATE INDEX "IdCheckDetail_subjectType_subjectId_idx" ON "IdCheckDetail"("subjectType", "subjectId");
CREATE INDEX "IdCheckDetail_photoExpiresAt_idx" ON "IdCheckDetail"("photoExpiresAt");
CREATE INDEX "IdCheckDetail_dateOfBirth_idx" ON "IdCheckDetail"("dateOfBirth");
ALTER TABLE "IdCheckDetail" ENABLE ROW LEVEL SECURITY;

-- Every Aadhaar QR attempt (rate limit, fraud flag after repeated invalid signatures). No QR data.
CREATE TABLE "AadhaarQrAttempt" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "staffId" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AadhaarQrAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AadhaarQrAttempt_subjectType_subjectId_attemptedAt_idx" ON "AadhaarQrAttempt"("subjectType", "subjectId", "attemptedAt");
ALTER TABLE "AadhaarQrAttempt" ENABLE ROW LEVEL SECURITY;
