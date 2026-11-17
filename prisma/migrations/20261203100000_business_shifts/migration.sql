-- Shifts per business (17 Nov, Master Guide rev 193): each business keeps its own
-- list of shifts (name, IST start and end); a vacancy picks one. Older vacancies
-- keep their free-text "shift".
CREATE TABLE "BusinessShift" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdByStaffId" TEXT,
    "createdByAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessShift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessShift_businessId_name_key" ON "BusinessShift"("businessId", "name");
CREATE INDEX "BusinessShift_businessId_idx" ON "BusinessShift"("businessId");

ALTER TABLE "BusinessShift" ADD CONSTRAINT "BusinessShift_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Vacancy" ADD COLUMN "businessShiftId" TEXT;
ALTER TABLE "Vacancy" ADD COLUMN "shiftStartTime" TEXT;
ALTER TABLE "Vacancy" ADD COLUMN "shiftEndTime" TEXT;
CREATE INDEX "Vacancy_businessShiftId_idx" ON "Vacancy"("businessShiftId");
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_businessShiftId_fkey" FOREIGN KEY ("businessShiftId") REFERENCES "BusinessShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Supabase publishes the public schema: RLS on, no policies (Prisma, the owner, keeps access).
ALTER TABLE "BusinessShift" ENABLE ROW LEVEL SECURITY;
