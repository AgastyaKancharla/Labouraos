-- Job seeker order Consent → Selfie → Payment → ID check (Master Guide rev 211, decided 25 Nov).
-- Additive only: no new table (so no new RLS policy), nothing renamed or dropped.

-- When his 30 days start: the later of the ₹499 confirmation and the ID check passing.
ALTER TABLE "JobSeeker" ADD COLUMN "guaranteeStartsAt" TIMESTAMP(3);

-- Existing rows: everyone already paid and ID-verified starts at the later of the two (only test
-- data exists; the backfill keeps those rows as they behaved, never moving a start earlier than
-- the payment).
UPDATE "JobSeeker" js
SET "guaranteeStartsAt" = GREATEST(js."paymentReceivedAt", v."firstVerifiedAt")
FROM (
  SELECT "jobSeekerId", MIN(COALESCE("verifiedAt", "createdAt")) AS "firstVerifiedAt"
  FROM "IdentityVerification"
  WHERE "status" = 'verified' AND "nameMatches" = true AND "isAdult" = true
  GROUP BY "jobSeekerId"
) v
WHERE v."jobSeekerId" = js."id"
  AND js."paymentReceivedAt" IS NOT NULL
  AND js."guaranteeStartsAt" IS NULL;

CREATE INDEX "JobSeeker_status_guaranteeStartsAt_idx" ON "JobSeeker"("status", "guaranteeStartsAt");

-- A ₹499 refund owed because the ID could not be verified (or under 18), and who paid it.
ALTER TABLE "Payment" ADD COLUMN "refundKind" TEXT;
ALTER TABLE "Payment" ADD COLUMN "refundPayerLinkId" TEXT;
