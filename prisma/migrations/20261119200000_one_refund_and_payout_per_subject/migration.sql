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
