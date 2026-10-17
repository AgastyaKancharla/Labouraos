-- AlterTable
ALTER TABLE "JobSeeker" ADD COLUMN     "paymentReceivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Vacancy" ADD COLUMN     "replacementForPlacementId" TEXT;

-- CreateIndex
CREATE INDEX "Vacancy_replacementForPlacementId_idx" ON "Vacancy"("replacementForPlacementId");

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_replacementForPlacementId_fkey" FOREIGN KEY ("replacementForPlacementId") REFERENCES "Placement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
