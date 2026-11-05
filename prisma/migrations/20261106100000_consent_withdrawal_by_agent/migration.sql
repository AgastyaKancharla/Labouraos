ALTER TABLE "Consent"
  ADD COLUMN "withdrawnMethod" TEXT,
  ADD COLUMN "withdrawnByStaffId" TEXT,
  ADD COLUMN "withdrawnCallRecordId" TEXT;

ALTER TABLE "PricingPolicy"
  ADD COLUMN "consentWithdrawalCallWindowMinutes" INTEGER NOT NULL DEFAULT 60;
