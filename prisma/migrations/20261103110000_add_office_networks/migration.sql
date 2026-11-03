-- AlterTable
ALTER TABLE "Staff" ADD COLUMN "worksFromOffice" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OfficeNetwork" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficeNetwork_active_idx" ON "OfficeNetwork"("active");

-- CreateIndex
CREATE INDEX "OfficeNetwork_addedByStaffId_idx" ON "OfficeNetwork"("addedByStaffId");

-- AddForeignKey
ALTER TABLE "OfficeNetwork" ADD CONSTRAINT "OfficeNetwork_addedByStaffId_fkey" FOREIGN KEY ("addedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
