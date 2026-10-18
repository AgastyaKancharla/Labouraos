-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "address" TEXT,
ADD COLUMN     "geofenceFlag" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gstNumber" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selfieHash" TEXT,
ADD COLUMN     "selfieUrl" TEXT;

-- AlterTable
ALTER TABLE "Vacancy" ADD COLUMN     "description" TEXT,
ADD COLUMN     "headcount" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "BusinessVisit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "staffId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "selfieUrl" TEXT,
    "selfieHash" TEXT,
    "geofenceFlag" BOOLEAN NOT NULL DEFAULT false,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessVisit_businessId_idx" ON "BusinessVisit"("businessId");

-- CreateIndex
CREATE INDEX "BusinessVisit_selfieHash_idx" ON "BusinessVisit"("selfieHash");

-- AddForeignKey
ALTER TABLE "BusinessVisit" ADD CONSTRAINT "BusinessVisit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessVisit" ADD CONSTRAINT "BusinessVisit_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
