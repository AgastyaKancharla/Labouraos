ALTER TABLE "JobSeeker"
  ADD COLUMN "guaranteeFloorPaise" INTEGER,
  ADD COLUMN "messageLanguage" TEXT,
  ADD COLUMN "heardFrom" TEXT;

ALTER TABLE "JobSeeker"
  ADD CONSTRAINT "JobSeeker_messageLanguage_check"
    CHECK ("messageLanguage" IS NULL OR "messageLanguage" IN ('kn', 'hi', 'en')),
  ADD CONSTRAINT "JobSeeker_heardFrom_check"
    CHECK ("heardFrom" IS NULL OR "heardFrom" IN ('toll_free_missed_call', 'ad', 'referral_partner', 'field_visit', 'social_media', 'walk_in', 'other')),
  ADD CONSTRAINT "JobSeeker_guaranteeFloorPaise_nonnegative_check"
    CHECK ("guaranteeFloorPaise" IS NULL OR "guaranteeFloorPaise" >= 0);
