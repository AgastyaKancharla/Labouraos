-- Phase 22 Part B: payroll from attendance, month-end close, review marks.

-- A day's pay is the monthly salary divided by this, the same every month (owner decision 11 Nov).
ALTER TABLE "PricingPolicy" ADD COLUMN "payrollSalaryDays" INTEGER NOT NULL DEFAULT 26;

-- Staff."joinedOn" (the joining date pay counts from) comes from 20261116100000_manager_portal; nothing here depends on it.

-- Money that arrived for a closed month is booked in the open month with a note.
ALTER TABLE "Payment" ADD COLUMN "bookingNote" TEXT;
ALTER TABLE "BankCredit" ADD COLUMN "bookingNote" TEXT;

CREATE TABLE "StaffAwayPeriod" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "leftAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAwayPeriod_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "StaffAwayPeriod" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "StaffAwayPeriod_staffId_idx" ON "StaffAwayPeriod"("staffId");

CREATE TABLE "StaffSalary" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "monthlyPaise" INTEGER NOT NULL,
    "effectiveFromMonth" TEXT NOT NULL,
    "note" TEXT,
    "setByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSalary_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "StaffSalary" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "StaffSalary_staffId_effectiveFromMonth_idx" ON "StaffSalary"("staffId", "effectiveFromMonth");

CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "people" INTEGER NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "deductionsPaise" INTEGER NOT NULL,
    "netPaise" INTEGER NOT NULL,
    "preparedByStaffId" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL,
    "approvedByStaffId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "returnedByStaffId" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnedReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PayrollRun" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "PayrollRun_month_key" ON "PayrollRun"("month");

CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "monthlyPaise" INTEGER NOT NULL,
    "salaryDays" INTEGER NOT NULL,
    "calendarDays" INTEGER NOT NULL,
    "workingDays" INTEGER NOT NULL,
    "holidays" INTEGER NOT NULL,
    "fullDays" INTEGER NOT NULL,
    "halfDays" INTEGER NOT NULL,
    "paidLeaveDays" INTEGER NOT NULL,
    "unpaidLeaveDays" INTEGER NOT NULL,
    "absentDays" INTEGER NOT NULL,
    "notEmployedDays" INTEGER NOT NULL,
    "unmarkedDays" INTEGER NOT NULL DEFAULT 0,
    "lossOfPayHalfDays" INTEGER NOT NULL,
    "paidHalfDays" INTEGER NOT NULL,
    "shortfallMinutes" INTEGER NOT NULL,
    "basicPaise" INTEGER NOT NULL,
    "hraPaise" INTEGER NOT NULL,
    "specialPaise" INTEGER NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "notEmployedPaise" INTEGER NOT NULL DEFAULT 0,
    "lossOfPayPaise" INTEGER NOT NULL,
    "shortfallPaise" INTEGER NOT NULL,
    "pfPaise" INTEGER NOT NULL DEFAULT 0,
    "esiPaise" INTEGER NOT NULL DEFAULT 0,
    "professionalTaxPaise" INTEGER NOT NULL DEFAULT 0,
    "deductionsPaise" INTEGER NOT NULL,
    "correctionPaise" INTEGER NOT NULL DEFAULT 0,
    "correctionNote" TEXT,
    "carryForwardPaise" INTEGER NOT NULL DEFAULT 0,
    "netPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "paidAt" TIMESTAMP(3),
    "paidByStaffId" TEXT,
    "paidFrom" TEXT,
    "utr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PayrollLine" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "PayrollLine_utr_key" ON "PayrollLine"("utr");
CREATE UNIQUE INDEX "PayrollLine_runId_staffId_key" ON "PayrollLine"("runId", "staffId");
CREATE INDEX "PayrollLine_staffId_idx" ON "PayrollLine"("staffId");
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MonthClose" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "closedByStaffId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "closeNote" TEXT,
    "checklist" JSONB NOT NULL,
    "reopenedByStaffId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthClose_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "MonthClose" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "MonthClose_month_key" ON "MonthClose"("month");

CREATE TABLE "MonthReviewMark" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "mark" TEXT NOT NULL,
    "note" TEXT,
    "byStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthReviewMark_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "MonthReviewMark" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "MonthReviewMark_month_subjectType_subjectId_key" ON "MonthReviewMark"("month", "subjectType", "subjectId");

CREATE TABLE "PayrollCorrection" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "relatesToMonth" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "appliedRunId" TEXT,
    "appliedMonth" TEXT,
    "createdByRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollCorrection_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PayrollCorrection" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "PayrollCorrection_staffId_appliedRunId_idx" ON "PayrollCorrection"("staffId", "appliedRunId");
CREATE INDEX "PayrollCorrection_relatesToMonth_idx" ON "PayrollCorrection"("relatesToMonth");
