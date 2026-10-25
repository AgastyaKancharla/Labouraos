-- AlterTable
ALTER TABLE "Placement" ADD COLUMN "invoiceCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Placement_invoiceCode_key" ON "Placement"("invoiceCode");
