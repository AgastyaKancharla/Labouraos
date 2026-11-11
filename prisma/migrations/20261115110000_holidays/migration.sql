-- Public holidays (owner decision, Master Guide Attendance). The CEO keeps the
-- list per year. A holiday is a paid day off for everyone: never absent, not a
-- leave day, and not a working day (same as a weekly day off).

CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdByStaffId" TEXT,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
