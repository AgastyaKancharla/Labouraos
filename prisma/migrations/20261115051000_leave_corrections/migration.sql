-- Phase 21 Task 4: leave balances, leave requests and correction requests.

ALTER TABLE "AttendanceDay" ADD COLUMN "leaveRequestId" TEXT;

CREATE TABLE "LeaveAccrual" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "casual" INTEGER NOT NULL,
    "emergency" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAccrual_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "routedToRole" TEXT NOT NULL,
    "routedToStaffId" TEXT,
    "routeReason" TEXT NOT NULL,
    "forwardedAt" TIMESTAMP(3),
    "forwardedByStaffId" TEXT,
    "forwardNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByStaffId" TEXT,
    "decidedByRole" TEXT,
    "decisionReason" TEXT,
    "paidDays" INTEGER NOT NULL DEFAULT 0,
    "unpaidDays" INTEGER NOT NULL DEFAULT 0,
    "overturnedAt" TIMESTAMP(3),
    "overturnedByStaffId" TEXT,
    "overturnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceCorrection" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "segmentStatus" TEXT NOT NULL DEFAULT 'available',
    "reason" TEXT NOT NULL,
    "monthNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "routedToRole" TEXT NOT NULL,
    "routedToStaffId" TEXT,
    "routeReason" TEXT NOT NULL,
    "forwardedAt" TIMESTAMP(3),
    "forwardedByStaffId" TEXT,
    "forwardNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByStaffId" TEXT,
    "decidedByRole" TEXT,
    "decisionReason" TEXT,
    "replacedSegments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeaveAccrual_staffId_month_key" ON "LeaveAccrual"("staffId", "month");
CREATE INDEX "LeaveRequest_staffId_status_idx" ON "LeaveRequest"("staffId", "status");
CREATE INDEX "LeaveRequest_status_createdAt_idx" ON "LeaveRequest"("status", "createdAt");
CREATE INDEX "AttendanceCorrection_staffId_status_idx" ON "AttendanceCorrection"("staffId", "status");
CREATE INDEX "AttendanceCorrection_status_createdAt_idx" ON "AttendanceCorrection"("status", "createdAt");

ALTER TABLE "LeaveAccrual" ADD CONSTRAINT "LeaveAccrual_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeaveAccrual" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceCorrection" ENABLE ROW LEVEL SECURITY;
