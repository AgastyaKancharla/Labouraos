-- The no-bypass charge (full fee + penalty percent + GST), raised by the CEO.
CREATE TABLE "BypassCharge" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "jobSeekerId" TEXT NOT NULL,
    "hiredOn" DATE NOT NULL,
    "introducedAt" TIMESTAMP(3) NOT NULL,
    "monthlySalaryPaise" INTEGER NOT NULL,
    "feePercent" INTEGER NOT NULL,
    "penaltyPercent" INTEGER NOT NULL,
    "gstPercent" INTEGER NOT NULL,
    "feePaise" INTEGER NOT NULL,
    "penaltyPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "invoiceCode" TEXT NOT NULL,
    "paymentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'raised',
    "raisedByStaffId" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "BypassCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BypassCharge_code_key" ON "BypassCharge"("code");
CREATE UNIQUE INDEX "BypassCharge_invoiceCode_key" ON "BypassCharge"("invoiceCode");
CREATE UNIQUE INDEX "BypassCharge_paymentId_key" ON "BypassCharge"("paymentId");
CREATE INDEX "BypassCharge_businessId_idx" ON "BypassCharge"("businessId");
CREATE INDEX "BypassCharge_jobSeekerId_idx" ON "BypassCharge"("jobSeekerId");

ALTER TABLE "BypassCharge" ENABLE ROW LEVEL SECURITY;
