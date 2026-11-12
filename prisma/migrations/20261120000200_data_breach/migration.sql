-- C-Privacy: the 72-hour data-breach register (CEO only).
CREATE TABLE "DataBreach" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "reportDueAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "dataAffected" TEXT NOT NULL,
    "peopleAffected" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "told" JSONB NOT NULL DEFAULT '[]',
    "boardToldAt" TIMESTAMP(3),
    "createdByStaffId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataBreach_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataBreach_code_key" ON "DataBreach"("code");
CREATE INDEX "DataBreach_status_reportDueAt_idx" ON "DataBreach"("status", "reportDueAt");

ALTER TABLE "DataBreach" ENABLE ROW LEVEL SECURITY;
