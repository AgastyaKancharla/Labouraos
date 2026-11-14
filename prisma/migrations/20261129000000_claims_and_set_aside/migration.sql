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

-- One owner call is the evidence of at most one claim (two claims made at the
-- same moment cannot share it). Old claims that already share a call are left
-- as they are (reported, not failed): the index then covers claims from now on.
DO $$
DECLARE
  shared integer;
BEGIN
  SELECT count(*) INTO shared FROM (
    SELECT "callRecordId" FROM "ReplacementClaim" GROUP BY "callRecordId" HAVING count(*) > 1
  ) d;
  IF shared = 0 THEN
    CREATE UNIQUE INDEX "ReplacementClaim_one_claim_per_call" ON "ReplacementClaim" ("callRecordId");
  ELSE
    RAISE NOTICE '% owner call(s) are already the evidence of more than one claim; the one-claim-per-call index covers claims reported from now on', shared;
    EXECUTE format(
      'CREATE UNIQUE INDEX "ReplacementClaim_one_claim_per_call" ON "ReplacementClaim" ("callRecordId") WHERE "reportedAt" > %L',
      now()
    );
  END IF;
END $$;

-- Bank UTRs in one spelling (no spaces, upper case), as the app now stores
-- them, so a legacy credit still blocks the same UTR typed differently. A row
-- whose cleaned UTR would clash with another credit's is left unchanged and
-- reported (never fails the migration).
DO $$
DECLARE
  clashing integer;
BEGIN
  SELECT count(*) INTO clashing FROM "BankCredit" b
  WHERE b."bankUtr" <> upper(regexp_replace(b."bankUtr", '\s+', '', 'g'))
    AND EXISTS (
      SELECT 1 FROM "BankCredit" o
      WHERE o."id" <> b."id"
        AND upper(regexp_replace(o."bankUtr", '\s+', '', 'g')) = upper(regexp_replace(b."bankUtr", '\s+', '', 'g'))
    );
  UPDATE "BankCredit" b
  SET "bankUtr" = upper(regexp_replace(b."bankUtr", '\s+', '', 'g'))
  WHERE b."bankUtr" <> upper(regexp_replace(b."bankUtr", '\s+', '', 'g'))
    AND NOT EXISTS (
      SELECT 1 FROM "BankCredit" o
      WHERE o."id" <> b."id"
        AND upper(regexp_replace(o."bankUtr", '\s+', '', 'g')) = upper(regexp_replace(b."bankUtr", '\s+', '', 'g'))
    );
  IF clashing > 0 THEN
    RAISE NOTICE '% bank credit UTR(s) were left as they are: cleaned, they would equal another credit''s UTR. Finance should check them.', clashing;
  END IF;
END $$;
