-- H2: refunds, referral payouts and joining rewards were created by "look, then
-- create" with no lock, so a double tap or a retry could create two. These
-- partial unique indexes make the database refuse a second live row; the
-- services also take an advisory lock and look again inside the transaction.
-- "Live" means any status except rejected (turned down by the CEO) or cancelled.
-- A failed payout stays live: it is retried, never created again.

-- The ₹499 registration payment a job seeker refund gives back. One live refund
-- per ₹499 paid: paying again after a refund starts a new guarantee, which may
-- end in a refund of its own.
ALTER TABLE "Payment" ADD COLUMN "refundsPaymentId" TEXT;

CREATE UNIQUE INDEX "Payment_one_live_refund_per_registration_fee"
  ON "Payment" ("refundsPaymentId")
  WHERE "type" = 'refund' AND "refundsPaymentId" IS NOT NULL AND "status" NOT IN ('rejected', 'cancelled');

-- Clean-up before the three placement indexes: if two requests already slipped
-- through, keep one live row per type and placement and mark the others cancelled,
-- with a note and a status-history row. The row kept is the one with money already
-- sent (a bank UTR), else the earliest. Nothing is deleted.
WITH "dup" AS (
  SELECT "id", "status" AS "fromStatus", "keepId"
  FROM (
    SELECT "id", "status",
           first_value("id") OVER w AS "keepId",
           row_number() OVER w AS "rn"
    FROM "Payment"
    WHERE "type" IN ('refund', 'referral_payout', 'joining_reward')
      AND "placementId" IS NOT NULL
      AND "status" NOT IN ('rejected', 'cancelled')
    WINDOW w AS (PARTITION BY "type", "placementId" ORDER BY ("bankUtr" IS NULL), "createdAt", "id")
  ) AS "ranked"
  WHERE "rn" > 1
), "cancelled" AS (
  UPDATE "Payment" AS p
  SET "status" = 'cancelled',
      "approvalNote" = left(concat_ws(' | ', p."approvalNote",
        'Cancelled by migration 20261119200000: a duplicate of payment ' || d."keepId" || ' for the same placement (one refund, referral payout or joining reward per placement)'), 1000),
      "updatedAt" = now()
  FROM "dup" AS d
  WHERE p."id" = d."id"
  RETURNING p."id"
)
INSERT INTO "StatusHistory" ("id", "subjectType", "subjectId", "fromStatus", "toStatus", "changedByStaffId", "reason", "changedAt")
SELECT gen_random_uuid()::text, 'payment', d."id", d."fromStatus", 'cancelled', NULL, 'duplicate_cancelled_by_migration', now()
FROM "dup" AS d
JOIN "cancelled" AS c ON c."id" = d."id";

-- One live business refund per placement.
CREATE UNIQUE INDEX "Payment_one_live_refund_per_placement"
  ON "Payment" ("placementId")
  WHERE "type" = 'refund' AND "placementId" IS NOT NULL AND "status" NOT IN ('rejected', 'cancelled');

-- One ₹200 referral payout per placement.
CREATE UNIQUE INDEX "Payment_one_referral_payout_per_placement"
  ON "Payment" ("placementId")
  WHERE "type" = 'referral_payout' AND "placementId" IS NOT NULL AND "status" NOT IN ('rejected', 'cancelled');

-- One ₹200 joining reward per placement.
CREATE UNIQUE INDEX "Payment_one_joining_reward_per_placement"
  ON "Payment" ("placementId")
  WHERE "type" = 'joining_reward' AND "placementId" IS NOT NULL AND "status" NOT IN ('rejected', 'cancelled');
