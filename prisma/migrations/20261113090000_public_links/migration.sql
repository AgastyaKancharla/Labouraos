CREATE TYPE "PublicLinkPurpose" AS ENUM (
  'registration',
  'payment_only',
  'referral_registration',
  'business_agreement',
  'interview_owner_result',
  'interview_candidate_result',
  'offer_reply',
  'payout_details',
  'vacancy_confirm'
);

CREATE TABLE "PublicLink" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" "PublicLinkPurpose" NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "phone" TEXT,
  "language" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "completedUserAgent" TEXT,
  "completedIpHash" TEXT,
  "createdByStaffId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PublicLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicLink_tokenHash_key" ON "PublicLink"("tokenHash");
CREATE INDEX "PublicLink_purpose_subjectType_subjectId_usedAt_revokedAt_expiresAt_idx"
  ON "PublicLink"("purpose", "subjectType", "subjectId", "usedAt", "revokedAt", "expiresAt");
CREATE INDEX "PublicLink_expiresAt_idx" ON "PublicLink"("expiresAt");

CREATE TABLE "OtpSession" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "phoneHash" TEXT NOT NULL,
  "phoneEncrypted" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "resendCount" INTEGER NOT NULL DEFAULT 0,
  "lastSentAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OtpSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OtpSession_requestId_key" ON "OtpSession"("requestId");
CREATE INDEX "OtpSession_expiresAt_idx" ON "OtpSession"("expiresAt");
