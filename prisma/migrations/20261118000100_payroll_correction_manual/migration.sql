-- A manual pay correction the CEO adds (POST /payroll/corrections, source
-- 'manual') records who added it. Null for corrections payroll made itself.
ALTER TABLE "PayrollCorrection" ADD COLUMN "createdByStaffId" TEXT;
