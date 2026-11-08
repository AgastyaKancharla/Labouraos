-- CreateTable PayoutAccount
CREATE TABLE "PayoutAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerNameAtEntry" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "maskedValue" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    "upiIdEncrypted" TEXT,
    "bankAccountEncrypted" TEXT,
    "ifsc" TEXT,
    "verifiedName" TEXT,
    "nameMatches" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'pending_validation',
    "validatedAt" TIMESTAMP(3),
    "activeFrom" TIMESTAMP(3) NOT NULL,
    "changeOtpRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutAccount_code_key" ON "PayoutAccount"("code");
CREATE INDEX "PayoutAccount_ownerType_ownerId_idx" ON "PayoutAccount"("ownerType", "ownerId");
CREATE INDEX "PayoutAccount_valueHash_idx" ON "PayoutAccount"("valueHash");
CREATE INDEX "PayoutAccount_status_idx" ON "PayoutAccount"("status");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payoutAccountId_fkey" FOREIGN KEY ("payoutAccountId") REFERENCES "PayoutAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
