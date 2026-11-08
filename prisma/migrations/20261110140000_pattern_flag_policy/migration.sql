-- AlterTable PricingPolicy
ALTER TABLE "PricingPolicy" ADD COLUMN "patternWindowDays" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "PricingPolicy" ADD COLUMN "patternBusinessMinInterviews" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "PricingPolicy" ADD COLUMN "patternStopDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "PricingPolicy" ADD COLUMN "patternAgentMinInterviews" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "PricingPolicy" ADD COLUMN "patternAgentRejectionPercent" INTEGER NOT NULL DEFAULT 80;
