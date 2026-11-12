-- Settings: behind-pace bells (start day, threshold) and how long the registration link stays valid.
ALTER TABLE "PricingPolicy" ADD COLUMN "behindPaceStartDay" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "PricingPolicy" ADD COLUMN "behindPaceThresholdPercent" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "PricingPolicy" ADD COLUMN "registrationLinkValidHours" INTEGER NOT NULL DEFAULT 48;
