-- CreateTable
CREATE TABLE "BankCredit" (
    "id" TEXT NOT NULL,
    "bankUtr" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "payerName" TEXT,
    "payerVpaMasked" TEXT,
    "remark" TEXT,
    "source" TEXT NOT NULL,
    "enteredByStaffId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unmatched',
    "matchedPaymentId" TEXT,
    "ignoredReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankCredit_bankUtr_key" ON "BankCredit"("bankUtr");

-- CreateIndex
CREATE UNIQUE INDEX "BankCredit_matchedPaymentId_key" ON "BankCredit"("matchedPaymentId");

-- CreateIndex
CREATE INDEX "BankCredit_status_idx" ON "BankCredit"("status");

-- CreateIndex
CREATE INDEX "BankCredit_createdAt_idx" ON "BankCredit"("createdAt");

-- AddForeignKey
ALTER TABLE "BankCredit" ADD CONSTRAINT "BankCredit_enteredByStaffId_fkey" FOREIGN KEY ("enteredByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCredit" ADD CONSTRAINT "BankCredit_matchedPaymentId_fkey" FOREIGN KEY ("matchedPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
