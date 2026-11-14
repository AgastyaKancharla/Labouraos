-- Replacement claims (PR #137 review): who reported a claim (so they never
-- decide it), and at most one claim waiting for a decision per placement.

ALTER TABLE "ReplacementClaim" ADD COLUMN "reportedByStaffId" TEXT;
ALTER TABLE "ReplacementClaim"
  ADD CONSTRAINT "ReplacementClaim_reportedByStaffId_fkey"
  FOREIGN KEY ("reportedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ReplacementClaim_reportedByStaffId_idx" ON "ReplacementClaim"("reportedByStaffId");

-- Why a claim was rejected, which decides whether it may be reported again
-- (owner decision 14 Nov; src/modules/placement/claim-refile.ts).
ALTER TABLE "ReplacementClaim" ADD COLUMN "rejectionCode" TEXT;

-- If two undecided claims already exist for one placement, keep the earliest
-- waiting and mark the later ones rejected with a note (nothing is deleted).
UPDATE "ReplacementClaim" c
SET "decision" = 'rejected',
    "decisionReason" = 'Closed automatically: another claim on this placement was already waiting for a decision',
    "decidedAt" = NOW()
WHERE c."decision" IS NULL
  AND EXISTS (
    SELECT 1 FROM "ReplacementClaim" o
    WHERE o."placementId" = c."placementId"
      AND o."decision" IS NULL
      AND (o."reportedAt" < c."reportedAt" OR (o."reportedAt" = c."reportedAt" AND o."id" < c."id"))
  );

CREATE UNIQUE INDEX "ReplacementClaim_one_open_per_placement"
  ON "ReplacementClaim" ("placementId")
  WHERE "decision" IS NULL;

-- Bank credits set aside (not Laboura's money): when and by whom, for the
-- Month-end review. Earlier set-asides keep these empty.
ALTER TABLE "BankCredit" ADD COLUMN "ignoredAt" TIMESTAMP(3);
ALTER TABLE "BankCredit" ADD COLUMN "ignoredByStaffId" TEXT;
ALTER TABLE "BankCredit"
  ADD CONSTRAINT "BankCredit_ignoredByStaffId_fkey"
  FOREIGN KEY ("ignoredByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
