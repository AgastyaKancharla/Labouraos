-- Phase 20 Task 5 follow-up: the registration link's terms-and-payment step records what he agreed to.
ALTER TABLE "JobSeeker"
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "termsAcceptedFloorPaise" INTEGER;
