-- Customer app: leads sent by referral partners (customer-only table).
-- Not a registration: the call team calls the person. Kept when the partner deletes their account.
CREATE TABLE "CustomerReferralLead" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "profileId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "kind" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "area" TEXT,
    "personAgreed" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "subjectType" TEXT,
    "subjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerReferralLead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerReferralLead_referralId_phone_key" ON "CustomerReferralLead"("referralId", "phone");
CREATE INDEX "CustomerReferralLead_status_createdAt_idx" ON "CustomerReferralLead"("status", "createdAt");
CREATE INDEX "CustomerReferralLead_accountId_idx" ON "CustomerReferralLead"("accountId");
CREATE INDEX "CustomerReferralLead_phone_idx" ON "CustomerReferralLead"("phone");
ALTER TABLE "CustomerReferralLead" ADD CONSTRAINT "CustomerReferralLead_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerReferralLead" ENABLE ROW LEVEL SECURITY;
