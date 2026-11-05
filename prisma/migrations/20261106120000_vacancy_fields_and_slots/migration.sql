-- Phase 13 Task 3: add the new vacancy profile and interview slot fields.
ALTER TABLE "Vacancy"
  ADD COLUMN "salaryMinPaise" INTEGER,
  ADD COLUMN "salaryMaxPaise" INTEGER,
  ADD COLUMN "salaryPeriod" TEXT,
  ADD COLUMN "roleTitle" TEXT,
  ADD COLUMN "extras" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "workingHours" TEXT,
  ADD COLUMN "shift" TEXT,
  ADD COLUMN "weeklyOff" TEXT,
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "locality" TEXT,
  ADD COLUMN "experienceRequiredYears" INTEGER,
  ADD COLUMN "educationRequired" TEXT,
  ADD COLUMN "languagesRequired" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "licencesRequired" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ageMin" INTEGER,
  ADD COLUMN "ageMax" INTEGER,
  ADD COLUMN "genderRequirement" TEXT,
  ADD COLUMN "genderReason" TEXT,
  ADD COLUMN "startDate" DATE,
  ADD COLUMN "urgency" TEXT,
  ADD COLUMN "probationDays" INTEGER,
  ADD COLUMN "interviewType" TEXT,
  ADD COLUMN "interviewContactName" TEXT,
  ADD COLUMN "capturedChannel" TEXT;

-- The legacy salary is a direct source value, so this is the sole data copy.
UPDATE "Vacancy" SET "salaryMinPaise" = "offeredSalary";
UPDATE "Vacancy"
SET "extras" = ARRAY[]::TEXT[],
    "languagesRequired" = ARRAY[]::TEXT[],
    "licencesRequired" = ARRAY[]::TEXT[];
ALTER TABLE "Vacancy" ALTER COLUMN "offeredSalary" DROP NOT NULL;

CREATE TABLE "VacancyInterviewSlot" (
  "id" TEXT NOT NULL,
  "vacancyId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "capacity" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VacancyInterviewSlot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VacancyInterviewSlot_vacancyId_startsAt_idx"
  ON "VacancyInterviewSlot"("vacancyId", "startsAt");

ALTER TABLE "VacancyInterviewSlot"
  ADD CONSTRAINT "VacancyInterviewSlot_vacancyId_fkey"
  FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PricingPolicy"
  ADD COLUMN "walkInStart" TEXT NOT NULL DEFAULT '10:30',
  ADD COLUMN "walkInEnd" TEXT NOT NULL DEFAULT '18:00';
