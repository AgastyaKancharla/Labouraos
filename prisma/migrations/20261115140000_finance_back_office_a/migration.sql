-- Phase 22 Part A: the Finance back office (expenses, payouts, money in, bank).

-- Unclaimed money is returned to the same UPI ID, never kept.
ALTER TABLE "BankCredit" ADD COLUMN "returnedUtr" TEXT;
ALTER TABLE "BankCredit" ADD COLUMN "returnedAt" TIMESTAMP(3);
ALTER TABLE "BankCredit" ADD COLUMN "returnedByStaffId" TEXT;
CREATE UNIQUE INDEX "BankCredit_returnedUtr_key" ON "BankCredit"("returnedUtr");

-- A payout the bank refused, recorded by Finance.
ALTER TABLE "Payment" ADD COLUMN "payoutFailureReason" TEXT;
ALTER TABLE "Payment" ADD COLUMN "payoutFailedAt" TIMESTAMP(3);

-- Referral payouts: Finance is warned before a partner's yearly total crosses the TDS limit.
ALTER TABLE "PricingPolicy" ADD COLUMN "referralTdsYearlyLimitPaise" INTEGER NOT NULL DEFAULT 2000000;

CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT 'Bengaluru',
    "category" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "adChannel" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL DEFAULT 0,
    "billDate" TIMESTAMP(3) NOT NULL,
    "paidFrom" TEXT,
    "billPath" TEXT,
    "billFileName" TEXT,
    "billContentType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting_finance',
    "needsCeo" BOOLEAN NOT NULL DEFAULT false,
    "enteredByStaffId" TEXT NOT NULL,
    "approvedByStaffId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByStaffId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "paidByStaffId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "Expense_code_key" ON "Expense"("code");
CREATE INDEX "Expense_status_idx" ON "Expense"("status");
CREATE INDEX "Expense_billDate_idx" ON "Expense"("billDate");
CREATE INDEX "Expense_category_idx" ON "Expense"("category");

CREATE TABLE "ExpenseBudget" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "setByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseBudget_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ExpenseBudget" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "ExpenseBudget_month_category_key" ON "ExpenseBudget"("month", "category");

CREATE TABLE "BankDayClose" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "openingPaise" INTEGER NOT NULL,
    "inPaise" INTEGER NOT NULL,
    "outPaise" INTEGER NOT NULL,
    "booksClosingPaise" INTEGER NOT NULL,
    "bankClosingPaise" INTEGER NOT NULL,
    "differencePaise" INTEGER NOT NULL,
    "note" TEXT,
    "closedByStaffId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankDayClose_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "BankDayClose" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "BankDayClose_day_key" ON "BankDayClose"("day");
