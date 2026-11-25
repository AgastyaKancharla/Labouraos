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

-- B9 (rev 212, same day): small businesses with little paperwork.
ALTER TABLE "Business" ADD COLUMN "verificationPath" TEXT;
CREATE TABLE "BusinessOwnerCheck" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "idMethod" TEXT,
    "idType" TEXT,
    "idLast4" TEXT,
    "idName" TEXT,
    "idResult" TEXT,
    "idFailureReason" TEXT,
    "idPhotoPath" TEXT,
    "idSubmittedAt" TIMESTAMP(3),
    "idCheckedAt" TIMESTAMP(3),
    "idCheckedByStaffId" TEXT,
    "idPhotoDeletedAt" TIMESTAMP(3),
    "idAttempts" INTEGER NOT NULL DEFAULT 0,
    "idAttemptsDay" TEXT,
    "businessProofKind" TEXT,
    "businessProofValue" TEXT,
    "businessProofAt" TIMESTAMP(3),
    "addressDocType" TEXT,
    "addressPhotoPath" TEXT,
    "addressSubmittedAt" TIMESTAMP(3),
    "addressResult" TEXT,
    "addressMatched" TEXT,
    "addressCheckedAt" TIMESTAMP(3),
    "addressCheckedByStaffId" TEXT,
    "addressPhotoDeletedAt" TIMESTAMP(3),
    "videoCallDoneAt" TIMESTAMP(3),
    "videoCallByStaffId" TEXT,
    "videoCallNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessOwnerCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BusinessOwnerCheck_businessId_key" ON "BusinessOwnerCheck"("businessId");
CREATE INDEX "BusinessOwnerCheck_idPhotoPath_idx" ON "BusinessOwnerCheck"("idPhotoPath");
CREATE INDEX "BusinessOwnerCheck_addressPhotoPath_idx" ON "BusinessOwnerCheck"("addressPhotoPath");
ALTER TABLE "BusinessOwnerCheck" ADD CONSTRAINT "BusinessOwnerCheck_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessOwnerCheck" ENABLE ROW LEVEL SECURITY;
