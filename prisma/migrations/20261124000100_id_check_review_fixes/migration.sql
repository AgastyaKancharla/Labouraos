-- ID check review fixes (Fable re-check of PR #135; owner rule: failed checks keep only the results).

-- A signed Aadhaar check that did not pass keeps only its results: no part of
-- the Aadhaar number, no QR reference and no QR time stamp.
UPDATE "IdentityVerification" SET "last4" = NULL, "vendorReference" = NULL, "qrIssuedAt" = NULL
  WHERE "method" = 'aadhaar_qr' AND "vendor" = 'uidai_secure_qr' AND "status" <> 'verified';
UPDATE "ReferralIdentityVerification" SET "last4" = NULL, "vendorReference" = NULL, "qrIssuedAt" = NULL
  WHERE "method" = 'aadhaar_qr' AND "vendor" = 'uidai_secure_qr' AND "status" <> 'verified';

-- The same for another ID (PAN, driving licence, voter ID) that was rejected, replaced or expired:
-- a failed check keeps no part of the number.
UPDATE "IdentityVerification" SET "last4" = NULL WHERE "vendor" = 'team_lead_check' AND "status" = 'failed';
UPDATE "ReferralIdentityVerification" SET "last4" = NULL WHERE "vendor" = 'team_lead_check' AND "status" = 'failed';

-- Failed signatures on recent QR codes (an early UIDAI key change shows up across many people).
ALTER TABLE "AadhaarQrAttempt" ADD COLUMN "recentQr" BOOLEAN;
CREATE INDEX "AadhaarQrAttempt_outcome_attemptedAt_idx" ON "AadhaarQrAttempt"("outcome", "attemptedAt");

-- One-time "camera opened" tokens for the live photo of another ID card.
CREATE TABLE "IdCaptureNonce" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "staffId" TEXT,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdCaptureNonce_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdCaptureNonce_nonceHash_key" ON "IdCaptureNonce"("nonceHash");
CREATE INDEX "IdCaptureNonce_expiresAt_idx" ON "IdCaptureNonce"("expiresAt");
ALTER TABLE "IdCaptureNonce" ENABLE ROW LEVEL SECURITY;
