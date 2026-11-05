CREATE TABLE "BusinessAgreement" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "termsHash" TEXT NOT NULL,
  "noBypassMonths" INTEGER NOT NULL,
  "noBypassPenaltyPercent" INTEGER NOT NULL,
  "feePercent" INTEGER NOT NULL,
  "gstPercent" INTEGER NOT NULL,
  "signedName" TEXT NOT NULL,
  "signedPhone" TEXT NOT NULL,
  "otpRequestId" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL,
  "documentStoragePath" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessAgreement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessAgreement_businessId_signedAt_idx"
  ON "BusinessAgreement"("businessId", "signedAt");

ALTER TABLE "BusinessAgreement"
  ADD CONSTRAINT "BusinessAgreement_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
