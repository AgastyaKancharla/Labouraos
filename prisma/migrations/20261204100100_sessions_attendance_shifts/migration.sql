-- Call agent and field agent fixes, decided 21 Nov (Master Guide rev 202).

-- Own shift per staff member (null = the company shift from Settings).
ALTER TABLE "Staff" ADD COLUMN "shiftStart" TEXT;
ALTER TABLE "Staff" ADD COLUMN "shiftEnd" TEXT;
-- Sessions ended by a password change, reset, lock or deactivation: the next sign-in needs a login code again.
ALTER TABLE "Staff" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);

-- "Still there?" counts from the last click, key, call or saved work.
ALTER TABLE "AttendanceDay" ADD COLUMN "lastActiveAt" TIMESTAMP(3);
-- "Resume my day" presses on the day (the second rings the Team Lead).
ALTER TABLE "AttendanceDay" ADD COLUMN "resumeCount" INTEGER NOT NULL DEFAULT 0;

-- The refresh token before the last renewal: a second tab is refused softly, other reuse ends the session.
ALTER TABLE "StaffSession" ADD COLUMN "previousTokenHash" TEXT;
ALTER TABLE "StaffSession" ADD COLUMN "tokenRotatedAt" TIMESTAMP(3);

-- "Still there?" after 30 minutes with no call and no click (was 10). The
-- current Settings row moves from the old default only; a value the CEO chose stays.
ALTER TABLE "PricingPolicy" ALTER COLUMN "idleAfterMinutes" SET DEFAULT 30;
UPDATE "PricingPolicy" SET "idleAfterMinutes" = 30
WHERE "idleAfterMinutes" = 10
  AND "id" = (
    SELECT "id" FROM "PricingPolicy"
    WHERE "effectiveFrom" <= now()
    ORDER BY "effectiveFrom" DESC, "createdAt" DESC
    LIMIT 1
  );
