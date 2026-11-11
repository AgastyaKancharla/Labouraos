-- N3 shortage tasks and N5 win-back list (proposals confirmed 11 Nov).

-- CreateTable
CREATE TABLE "ShortageTask" (
    "id" TEXT NOT NULL,
    "openKey" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Bengaluru',
    "tradeKey" TEXT NOT NULL,
    "trade" TEXT NOT NULL,
    "areaKey" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openPositions" INTEGER NOT NULL,
    "vacancyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedTeamLeadId" TEXT,
    "title" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShortageTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WinBackEntry" (
    "id" TEXT NOT NULL,
    "openKey" TEXT,
    "jobSeekerId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "addedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "closedByStaffId" TEXT,
    "callRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WinBackEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShortageTask_openKey_key" ON "ShortageTask"("openKey");
CREATE INDEX "ShortageTask_status_assignedTeamLeadId_idx" ON "ShortageTask"("status", "assignedTeamLeadId");
CREATE INDEX "ShortageTask_tradeKey_areaKey_idx" ON "ShortageTask"("tradeKey", "areaKey");

CREATE UNIQUE INDEX "WinBackEntry_openKey_key" ON "WinBackEntry"("openKey");
CREATE UNIQUE INDEX "WinBackEntry_jobSeekerId_vacancyId_key" ON "WinBackEntry"("jobSeekerId", "vacancyId");
CREATE INDEX "WinBackEntry_status_addedAt_idx" ON "WinBackEntry"("status", "addedAt");
CREATE INDEX "WinBackEntry_jobSeekerId_idx" ON "WinBackEntry"("jobSeekerId");

-- Supabase exposes the public schema through its REST API: RLS on, no policies.
ALTER TABLE "ShortageTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WinBackEntry" ENABLE ROW LEVEL SECURITY;
