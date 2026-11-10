ALTER TABLE "Business"
  ADD COLUMN "familyName" TEXT,
  ADD COLUMN "contactRole" TEXT,
  ADD COLUMN "contactWhatsAppPhone" TEXT,
  ADD COLUMN "contactLanguage" TEXT,
  ADD COLUMN "employeeCountBand" TEXT,
  ADD COLUMN "yearsInOperationBand" TEXT,
  ADD COLUMN "openingTime" TEXT,
  ADD COLUMN "closingTime" TEXT,
  ADD COLUMN "workingDays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "shopNumber" TEXT,
  ADD COLUMN "street" TEXT,
  ADD COLUMN "landmark" TEXT,
  ADD COLUMN "pincode" TEXT,
  ADD COLUMN "billingEmail" TEXT,
  ADD COLUMN "heardFrom" TEXT,
  ADD COLUMN "fssaiNumber" TEXT;

UPDATE "Business"
SET "additionalContactName" = COALESCE("additionalContactName", "ownerName"),
    "additionalContactPhone" = COALESCE("additionalContactPhone", "phone"),
    "contactRole" = COALESCE("contactRole", 'owner');

CREATE TABLE "BusinessBranch" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shopNumber" TEXT,
  "street" TEXT,
  "landmark" TEXT,
  "address" TEXT,
  "locality" TEXT,
  "pincode" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "contactPersonName" TEXT NOT NULL,
  "contactPersonRole" TEXT NOT NULL,
  "contactPersonPhone" TEXT NOT NULL,
  "contactWhatsAppPhone" TEXT,
  "contactLanguage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessBranch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessBranch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BusinessBranch_businessId_idx" ON "BusinessBranch"("businessId");
CREATE INDEX "BusinessBranch_contactPersonPhone_idx" ON "BusinessBranch"("contactPersonPhone");

ALTER TABLE "Vacancy" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "BusinessBranch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Vacancy_branchId_idx" ON "Vacancy"("branchId");

ALTER TABLE "BusinessAgreement" ADD COLUMN "signedRole" TEXT;
