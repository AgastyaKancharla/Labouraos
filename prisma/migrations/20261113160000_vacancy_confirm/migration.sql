-- Phase 20 Task 8: every vacancy confirmed by the contact person's OTP, and the legal minimum wage warning.
-- New statuses 'draft' and 'awaiting_confirmation' are plain strings in Vacancy.status; existing rows keep their status.
ALTER TABLE "Vacancy"
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmationMethod" TEXT,
  ADD COLUMN "confirmedByName" TEXT,
  ADD COLUMN "confirmedByRole" TEXT,
  ADD COLUMN "confirmedPhoneLast4" TEXT,
  ADD COLUMN "confirmationRecordedByStaffId" TEXT,
  ADD COLUMN "belowLegalMinimum" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ownerToldMinimumWage" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "legalMinimumPaise" INTEGER;

CREATE INDEX "Vacancy_belowLegalMinimum_idx" ON "Vacancy"("belowLegalMinimum");
