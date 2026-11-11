-- Pause a referral partner (owner decision, Master Guide, Referral partners):
-- CEO only, reason required, audited. A paused partner's new referrals are
-- refused; money already earned is still paid. Unpause clears these.
ALTER TABLE "Referral" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "Referral" ADD COLUMN "pausedByStaffId" TEXT;
ALTER TABLE "Referral" ADD COLUMN "pauseReason" TEXT;
