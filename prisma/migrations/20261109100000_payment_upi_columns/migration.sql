ALTER TABLE "Payment"
  ALTER COLUMN "gatewayReference" DROP NOT NULL,
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'upi_direct',
  ADD COLUMN "upiReference" TEXT,
  ADD COLUMN "expectedAmountPaise" INTEGER,
  ADD COLUMN "bankUtr" TEXT,
  ADD COLUMN "confirmedBy" TEXT,
  ADD COLUMN "confirmedByStaffId" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "approvedByStaffId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "payoutAccountId" TEXT,
  ADD COLUMN "payerUtrHint" TEXT;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_upiReference_key" UNIQUE ("upiReference"),
  ADD CONSTRAINT "Payment_bankUtr_key" UNIQUE ("bankUtr");
