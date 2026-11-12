-- The Settings in force when a salary sheet was prepared, kept on the sheet so
-- the correction recompute of an approved month uses exactly them (a
-- back-dated Settings version can never create false corrections).
-- "fullDayMinutes" is null on sheets prepared before this change: those fall
-- back to the Settings version in force at their preparedAt. A list column
-- can't be optional in Prisma, so "weeklyOffDays" defaults to an empty list
-- and is only read when "fullDayMinutes" is set.
ALTER TABLE "PayrollRun" ADD COLUMN "weeklyOffDays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "PayrollRun" ADD COLUMN "fullDayMinutes" INTEGER;
