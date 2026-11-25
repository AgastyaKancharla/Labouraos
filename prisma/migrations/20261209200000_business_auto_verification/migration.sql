-- Business automatic verification (Master Guide rev 211, "Decided 25 Nov").
-- B1 owner photos on the agreement link, B2 proofs, B3 the automatic check, B4 the
-- vacancy check and B6 the second check after the first interview. Additive only.

-- B1: home business; B2: the Google Maps link proof; B3: the automatic check's result.
ALTER TABLE "Business" ADD COLUMN "runsFromHome" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Business" ADD COLUMN "mapsLink" TEXT;
ALTER TABLE "Business" ADD COLUMN "mapsLatitude" DOUBLE PRECISION;
ALTER TABLE "Business" ADD COLUMN "mapsLongitude" DOUBLE PRECISION;
ALTER TABLE "Business" ADD COLUMN "mapsPlaceName" TEXT;
ALTER TABLE "Business" ADD COLUMN "autoCheckStatus" TEXT;
ALTER TABLE "Business" ADD COLUMN "autoCheckedAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "autoCheckReasons" JSONB;
ALTER TABLE "Business" ADD COLUMN "autoCheckDistanceMeters" INTEGER;
ALTER TABLE "Business" ADD COLUMN "autoVerifiedAt" TIMESTAMP(3);

-- B1: the owner's live photos (selfie, shop name board or FSSAI licence held by the owner).
CREATE TABLE "BusinessOwnerPhoto" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "photoHash" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "locationStatus" TEXT,
    "takenVia" TEXT NOT NULL,
    "takenByStaffId" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessOwnerPhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BusinessOwnerPhoto_businessId_kind_idx" ON "BusinessOwnerPhoto"("businessId", "kind");
CREATE INDEX "BusinessOwnerPhoto_photoHash_idx" ON "BusinessOwnerPhoto"("photoHash");
ALTER TABLE "BusinessOwnerPhoto" ADD CONSTRAINT "BusinessOwnerPhoto_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessOwnerPhoto" ENABLE ROW LEVEL SECURITY;

-- B4: the Team Lead's check of an unusual vacancy.
ALTER TABLE "Vacancy" ADD COLUMN "tlCheckReasons" JSONB;
ALTER TABLE "Vacancy" ADD COLUMN "tlCheckedAt" TIMESTAMP(3);
ALTER TABLE "Vacancy" ADD COLUMN "tlCheckedByStaffId" TEXT;
ALTER TABLE "Vacancy" ADD COLUMN "tlCheckDecision" TEXT;

-- B6: "Was the shop real, at this address, and was the job as described?"
ALTER TABLE "Interview" ADD COLUMN "shopCheckAsked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Interview" ADD COLUMN "shopCheckAnswer" TEXT;
ALTER TABLE "Interview" ADD COLUMN "shopCheckAt" TIMESTAMP(3);
ALTER TABLE "Interview" ADD COLUMN "shopCheckChannel" TEXT;
ALTER TABLE "Interview" ADD COLUMN "shopCheckByStaffId" TEXT;
ALTER TABLE "Interview" ADD COLUMN "shopCheckNote" TEXT;
