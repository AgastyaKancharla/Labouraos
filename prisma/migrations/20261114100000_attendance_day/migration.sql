-- Phase 21 Task 2: the working day.
-- Attendance settings live on PricingPolicy. Managers cannot see or change them.
-- refundPriorityWindowDays is stored here; MoneyAtRiskService keeps its own
-- windows until Task 7.

ALTER TABLE "PricingPolicy" ADD COLUMN "shiftStart" TEXT NOT NULL DEFAULT '09:30';
ALTER TABLE "PricingPolicy" ADD COLUMN "shiftEnd" TEXT NOT NULL DEFAULT '18:30';
ALTER TABLE "PricingPolicy" ADD COLUMN "productionHoursFullDay" DOUBLE PRECISION NOT NULL DEFAULT 8;
ALTER TABLE "PricingPolicy" ADD COLUMN "halfDayBelowHours" DOUBLE PRECISION NOT NULL DEFAULT 4.5;
ALTER TABLE "PricingPolicy" ADD COLUMN "dayToleranceMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "PricingPolicy" ADD COLUMN "lateGraceMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "PricingPolicy" ADD COLUMN "shortBreakMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "PricingPolicy" ADD COLUMN "lunchMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "PricingPolicy" ADD COLUMN "idleAfterMinutes" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "PricingPolicy" ADD COLUMN "casualLeavePerMonth" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PricingPolicy" ADD COLUMN "emergencyLeavePerMonth" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PricingPolicy" ADD COLUMN "refundPriorityWindowDays" INTEGER NOT NULL DEFAULT 15;

CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "loginAt" TIMESTAMP(3) NOT NULL,
    "logoutAt" TIMESTAMP(3),
    "loginLat" DOUBLE PRECISION,
    "loginLng" DOUBLE PRECISION,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "productionSeconds" INTEGER NOT NULL DEFAULT 0,
    "breakSeconds" INTEGER NOT NULL DEFAULT 0,
    "idleSeconds" INTEGER NOT NULL DEFAULT 0,
    "dayType" TEXT NOT NULL DEFAULT 'open',
    "closedReason" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceSegment" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSegment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceDay_staffId_date_key" ON "AttendanceDay"("staffId", "date");
CREATE INDEX "AttendanceDay_staffId_idx" ON "AttendanceDay"("staffId");
CREATE INDEX "AttendanceDay_date_idx" ON "AttendanceDay"("date");
CREATE INDEX "AttendanceSegment_dayId_startedAt_idx" ON "AttendanceSegment"("dayId", "startedAt");
CREATE INDEX "AttendanceSegment_staffId_idx" ON "AttendanceSegment"("staffId");

ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceSegment" ADD CONSTRAINT "AttendanceSegment_dayId_fkey"
  FOREIGN KEY ("dayId") REFERENCES "AttendanceDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
