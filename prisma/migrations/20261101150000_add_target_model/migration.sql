-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "candidatesActivated" INTEGER,
    "refundRate" DOUBLE PRECISION,
    "vacanciesCaptured" INTEGER,
    "placementsClosed" INTEGER,
    "replacementsInside15Days" INTEGER,
    "repeatBusinesses" INTEGER,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Target_staffId_year_month_key" ON "Target"("staffId", "year", "month");

-- CreateIndex
CREATE INDEX "Target_staffId_idx" ON "Target"("staffId");

-- CreateIndex
CREATE INDEX "Target_year_month_idx" ON "Target"("year", "month");

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
