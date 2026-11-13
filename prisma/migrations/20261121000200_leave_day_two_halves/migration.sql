-- Two half days of leave on one date (two requests, same kind) make one full
-- leave day; the second request is kept here so either can be overturned.
ALTER TABLE "AttendanceDay" ADD COLUMN "otherLeaveRequestId" TEXT;
