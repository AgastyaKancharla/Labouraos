-- AlterTable
ALTER TABLE "JobSeeker" ADD COLUMN "registeredByStaffId" TEXT;

-- AlterTable
ALTER TABLE "Placement" ADD COLUMN "createdByStaffId" TEXT;

-- CreateIndex
CREATE INDEX "JobSeeker_registeredByStaffId_idx" ON "JobSeeker"("registeredByStaffId");

-- CreateIndex
CREATE INDEX "Placement_createdByStaffId_idx" ON "Placement"("createdByStaffId");

-- AddForeignKey
ALTER TABLE "JobSeeker" ADD CONSTRAINT "JobSeeker_registeredByStaffId_fkey" FOREIGN KEY ("registeredByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_createdByStaffId_fkey" FOREIGN KEY ("createdByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
