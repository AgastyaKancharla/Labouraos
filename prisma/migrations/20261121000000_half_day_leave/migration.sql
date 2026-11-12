-- Half-day leave (owner decision 12 Nov): "Staff request leave with a calendar
-- and a reason, for full days or a half day (first half or second half); a half
-- day of leave uses half a day of the balance, and the other half is a normal
-- working half day."

-- The request: which half of its one date (null = full days); day counts in halves.
ALTER TABLE "LeaveRequest" ADD COLUMN "half" TEXT;
ALTER TABLE "LeaveRequest" ALTER COLUMN "days" TYPE DOUBLE PRECISION;
ALTER TABLE "LeaveRequest" ALTER COLUMN "paidDays" TYPE DOUBLE PRECISION;
ALTER TABLE "LeaveRequest" ALTER COLUMN "unpaidDays" TYPE DOUBLE PRECISION;
ALTER TABLE "LeaveRequest" ALTER COLUMN "approvedDays" TYPE DOUBLE PRECISION;

-- The attendance day: a half day of leave, and a full leave day that is half paid, half unpaid.
ALTER TABLE "AttendanceDay" ADD COLUMN "leaveHalf" TEXT;
ALTER TABLE "AttendanceDay" ADD COLUMN "leavePartUnpaid" BOOLEAN NOT NULL DEFAULT false;

-- The salary sheet's day counts can be half days now.
ALTER TABLE "PayrollLine" ALTER COLUMN "fullDays" TYPE DOUBLE PRECISION;
ALTER TABLE "PayrollLine" ALTER COLUMN "paidLeaveDays" TYPE DOUBLE PRECISION;
ALTER TABLE "PayrollLine" ALTER COLUMN "unpaidLeaveDays" TYPE DOUBLE PRECISION;
ALTER TABLE "PayrollLine" ALTER COLUMN "absentDays" TYPE DOUBLE PRECISION;
