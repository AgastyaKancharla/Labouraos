-- Targets split automatically (Master Guide rev 195, 17 Nov): the CEO's plan is
-- split to Managers, teams and agents. A value set by hand is kept and marked.
ALTER TABLE "TeamPlan" ADD COLUMN "handSetFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "TeamPlan" ADD COLUMN "leaverCredit" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Target" ADD COLUMN "handSetFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Target" ADD COLUMN "splitFromDay" INTEGER;

-- Backfill, part 1: every number already typed by a Manager (or the CEO) is
-- treated as set by hand, so the first automatic split never overwrites it.
UPDATE "TeamPlan" SET "handSetFields" = array_remove(ARRAY[
  CASE WHEN "registered" IS NOT NULL THEN 'registered' END,
  CASE WHEN "paid" IS NOT NULL THEN 'paid' END,
  CASE WHEN "businessesSignedUp" IS NOT NULL THEN 'businessesSignedUp' END,
  CASE WHEN "vacancies" IS NOT NULL THEN 'vacancies' END,
  CASE WHEN "interviewsDone" IS NOT NULL THEN 'interviewsDone' END,
  CASE WHEN "placed" IS NOT NULL THEN 'placed' END,
  CASE WHEN "leftWithin30" IS NOT NULL THEN 'leftWithin30' END,
  CASE WHEN "repeatBusinesses" IS NOT NULL THEN 'repeatBusinesses' END
]::TEXT[], NULL);

UPDATE "Target" SET "handSetFields" = array_remove(ARRAY[
  CASE WHEN "candidatesActivated" IS NOT NULL THEN 'candidatesActivated' END,
  CASE WHEN "vacanciesCaptured" IS NOT NULL THEN 'vacanciesCaptured' END,
  CASE WHEN "placementsClosed" IS NOT NULL THEN 'placementsClosed' END,
  CASE WHEN "repeatBusinesses" IS NOT NULL THEN 'repeatBusinesses' END
]::TEXT[], NULL);

-- Backfill, part 2 (the split itself needs the app's counting): when the app
-- starts it splits each current or future month that has a CEO plan and no
-- automatic split yet (TargetSplitService.backfill); the CEO can also run it
-- with "Split again" (POST /plans/company/split).
