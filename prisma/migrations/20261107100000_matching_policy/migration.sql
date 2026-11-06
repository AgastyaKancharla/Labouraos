ALTER TABLE "PricingPolicy"
  ADD COLUMN "matchPageSize" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "salaryDaysPerMonth" INTEGER NOT NULL DEFAULT 26,
  ADD COLUMN "matchingWeights" JSONB NOT NULL DEFAULT '{"clock":30,"distance":20,"experience":15,"salary":15,"reliability":10,"completeness":5,"pastResults":5}'::jsonb;
