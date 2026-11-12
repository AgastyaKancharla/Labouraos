-- The Monday weekly report, kept as a snapshot per Manager's tree and for the
-- whole company (MG-Reports "sent every Monday at 9 AM", C-Reports).

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "ownerStaffId" TEXT,
    "weekStart" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeeklyReport_scopeKey_weekStart_key" ON "WeeklyReport"("scopeKey", "weekStart");
CREATE INDEX "WeeklyReport_ownerStaffId_weekStart_idx" ON "WeeklyReport"("ownerStaffId", "weekStart");

ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_ownerStaffId_fkey" FOREIGN KEY ("ownerStaffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WeeklyReport" ENABLE ROW LEVEL SECURITY;
