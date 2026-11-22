-- Attendance start (Master Guide rev 206, decided 22 Nov): time in "Start of day"
-- (from the sign-in to the first status picked), unproductive, kept per day.
ALTER TABLE "AttendanceDay" ADD COLUMN "startOfDaySeconds" INTEGER NOT NULL DEFAULT 0;
