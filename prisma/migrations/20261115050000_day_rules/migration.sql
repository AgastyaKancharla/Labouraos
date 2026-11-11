-- Phase 21 Task 3: full days, half days, shortfall and the month.
-- An absent day or a leave day has no login, so loginAt becomes optional.
-- No new table, so no row level security change is needed here.

ALTER TABLE "AttendanceDay" ALTER COLUMN "loginAt" DROP NOT NULL;
ALTER TABLE "AttendanceDay" ADD COLUMN "shortfallSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AttendanceDay" ADD COLUMN "makeUpSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AttendanceDay" ADD COLUMN "leaveKind" TEXT;
ALTER TABLE "AttendanceDay" ADD COLUMN "leaveUnpaid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceDay" ADD COLUMN "dayTypeChangedById" TEXT;
ALTER TABLE "AttendanceDay" ADD COLUMN "dayTypeChangedAt" TIMESTAMP(3);
ALTER TABLE "AttendanceDay" ADD COLUMN "dayTypeChangeReason" TEXT;

-- Weekly days off (0 = Sunday). To confirm with Agastya; Sunday to start.
ALTER TABLE "PricingPolicy" ADD COLUMN "weeklyOffDays" INTEGER[] NOT NULL DEFAULT ARRAY[0]::INTEGER[];

-- Days closed before this change get their day type from production.
UPDATE "AttendanceDay"
SET "dayType" = CASE
    WHEN "productionSeconds" >= 8 * 3600 - 10 * 60 THEN 'full'
    WHEN "productionSeconds" < 4.5 * 3600 - 10 * 60 THEN 'half'
    ELSE 'full'
  END,
  "shortfallSeconds" = CASE
    WHEN "productionSeconds" >= 8 * 3600 - 10 * 60 THEN 0
    WHEN "productionSeconds" < 4.5 * 3600 - 10 * 60 THEN 0
    ELSE 8 * 3600 - "productionSeconds"
  END,
  "makeUpSeconds" = GREATEST(0, "productionSeconds" - 8 * 3600)
WHERE "logoutAt" IS NOT NULL AND "dayType" = 'open';
