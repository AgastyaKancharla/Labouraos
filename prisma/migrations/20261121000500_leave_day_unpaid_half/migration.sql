-- Two half days of one date: which request's half is the unpaid one, so each
-- request keeps the paid/unpaid split it got when it was approved.
ALTER TABLE "AttendanceDay" ADD COLUMN "otherLeaveUnpaid" BOOLEAN NOT NULL DEFAULT false;
