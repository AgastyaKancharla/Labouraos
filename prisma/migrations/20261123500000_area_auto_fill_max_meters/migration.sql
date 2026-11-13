-- Settings (owner decision 14 Nov): a new business's area is filled in from its
-- GPS pin only when an area's centre is within this many metres (1 km).
-- Farther than that, the agent must pick the area from the list before saving.
ALTER TABLE "PricingPolicy" ADD COLUMN "areaAutoFillMaxMeters" INTEGER NOT NULL DEFAULT 1000;
