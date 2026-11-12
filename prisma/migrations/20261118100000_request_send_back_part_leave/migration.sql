-- Manager request details (MG-Req-Sneha, MG-Req-Vikram): "Send back to the
-- Team Lead" on leave and corrections, and approving part of a leave request.
-- Columns only; no new table.

ALTER TABLE "LeaveRequest" ADD COLUMN "approvedFromDate" DATE;
ALTER TABLE "LeaveRequest" ADD COLUMN "approvedToDate" DATE;
ALTER TABLE "LeaveRequest" ADD COLUMN "approvedDays" INTEGER;
ALTER TABLE "LeaveRequest" ADD COLUMN "sentBackAt" TIMESTAMP(3);
ALTER TABLE "LeaveRequest" ADD COLUMN "sentBackByStaffId" TEXT;
ALTER TABLE "LeaveRequest" ADD COLUMN "sentBackNote" TEXT;

ALTER TABLE "AttendanceCorrection" ADD COLUMN "sentBackAt" TIMESTAMP(3);
ALTER TABLE "AttendanceCorrection" ADD COLUMN "sentBackByStaffId" TEXT;
ALTER TABLE "AttendanceCorrection" ADD COLUMN "sentBackNote" TEXT;
