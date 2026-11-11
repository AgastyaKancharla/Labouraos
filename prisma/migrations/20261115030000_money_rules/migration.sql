-- Money rules (guide: Money rules at a glance, Finance portal, approval limits).
-- 1. Approval limits live in Settings (PricingPolicy); only the CEO changes them.
ALTER TABLE "PricingPolicy" ADD COLUMN "financeBusinessRefundLimitPaise" INTEGER NOT NULL DEFAULT 1500000;
ALTER TABLE "PricingPolicy" ADD COLUMN "financeExpenseLimitPaise" INTEGER NOT NULL DEFAULT 1000000;

-- 2. Company details for GST invoices come from Settings.
ALTER TABLE "PricingPolicy" ADD COLUMN "companyLegalName" TEXT NOT NULL DEFAULT 'Laboura Private Limited';
ALTER TABLE "PricingPolicy" ADD COLUMN "companyGstin" TEXT;
ALTER TABLE "PricingPolicy" ADD COLUMN "companyAddress" TEXT;

-- 3. Refunds that need the CEO (above Finance's limit, outside the rules, or sent by Finance).
ALTER TABLE "Payment" ADD COLUMN "ceoApprovalReason" TEXT;
ALTER TABLE "Payment" ADD COLUMN "sentToCeoByStaffId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "sentToCeoAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD COLUMN "outsideRules" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "approvalNote" TEXT;

-- 4. TDS deducted by businesses from placement fees.
CREATE TABLE "TdsReceivable" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Bengaluru',
    "placementId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "bankCreditId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "sectionNote" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'certificate_due',
    "recordedByStaffId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TdsReceivable_pkey" PRIMARY KEY ("id")
);

-- Supabase exposes public tables through its REST API; RLS with no policies hides
-- this one there while Prisma (the owner) keeps full access.
ALTER TABLE "TdsReceivable" ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX "TdsReceivable_paymentId_key" ON "TdsReceivable"("paymentId");
CREATE UNIQUE INDEX "TdsReceivable_bankCreditId_key" ON "TdsReceivable"("bankCreditId");
CREATE INDEX "TdsReceivable_placementId_idx" ON "TdsReceivable"("placementId");
CREATE INDEX "TdsReceivable_status_idx" ON "TdsReceivable"("status");

ALTER TABLE "TdsReceivable" ADD CONSTRAINT "TdsReceivable_placementId_fkey" FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TdsReceivable" ADD CONSTRAINT "TdsReceivable_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TdsReceivable" ADD CONSTRAINT "TdsReceivable_bankCreditId_fkey" FOREIGN KEY ("bankCreditId") REFERENCES "BankCredit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
