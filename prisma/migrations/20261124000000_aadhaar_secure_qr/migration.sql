-- Aadhaar verification (Master Guide, 14 Nov): an in-house check of UIDAI's
-- Secure QR code. No verification company and no DigiLocker.

-- What each check keeps besides verified yes/no, the method and the time.
ALTER TABLE "IdentityVerification" ADD COLUMN "phoneLinked" TEXT;
ALTER TABLE "IdentityVerification" ADD COLUMN "qrIssuedAt" TIMESTAMP(3);
ALTER TABLE "IdentityVerification" ADD COLUMN "consentId" TEXT;
ALTER TABLE "ReferralIdentityVerification" ADD COLUMN "phoneLinked" TEXT;
ALTER TABLE "ReferralIdentityVerification" ADD COLUMN "qrIssuedAt" TIMESTAMP(3);
ALTER TABLE "ReferralIdentityVerification" ADD COLUMN "consentId" TEXT;

-- Checks made before 14 Nov through the old Aadhaar route keep their result;
-- they are relabelled so nothing refers to that route any more.
UPDATE "IdentityVerification" SET "method" = 'aadhaar_older_check' WHERE "method" = 'digilocker';
UPDATE "IdentityVerification" SET "vendor" = 'older_check' WHERE "vendor" = 'digilocker';
UPDATE "ReferralIdentityVerification" SET "method" = 'aadhaar_older_check' WHERE "method" = 'digilocker';
UPDATE "ReferralIdentityVerification" SET "vendor" = 'older_check' WHERE "vendor" = 'digilocker';

-- Name, date of birth, gender, area and pincode from the QR, and the QR photo
-- until the Team Lead's check (30 days at most).
CREATE TABLE "AadhaarQrDetail" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "nameOnId" TEXT NOT NULL,
    "dateOfBirth" TEXT NOT NULL,
    "gender" TEXT,
    "area" TEXT,
    "pincode" TEXT,
    "photoPath" TEXT,
    "photoExpiresAt" TIMESTAMP(3),
    "photoDeletedAt" TIMESTAMP(3),
    "photoDeletedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AadhaarQrDetail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AadhaarQrDetail_verificationId_key" ON "AadhaarQrDetail"("verificationId");
CREATE INDEX "AadhaarQrDetail_subjectType_subjectId_idx" ON "AadhaarQrDetail"("subjectType", "subjectId");
CREATE INDEX "AadhaarQrDetail_photoExpiresAt_idx" ON "AadhaarQrDetail"("photoExpiresAt");
ALTER TABLE "AadhaarQrDetail" ENABLE ROW LEVEL SECURITY;

-- Every attempt (rate limit, fraud flag after repeated invalid signatures). No QR data.
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
