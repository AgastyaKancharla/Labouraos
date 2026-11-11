-- Field agent shop visits (Master Guide, "The field agent app (decided 9 Nov)"):
-- a visit can start before the shop is registered, carries the live name-board
-- photo, the visit timer, the outcome with revisit date, and the proof selfie
-- with a second GPS check.
ALTER TABLE "BusinessVisit" ALTER COLUMN "businessId" DROP NOT NULL;
ALTER TABLE "BusinessVisit"
  ADD COLUMN "accuracyMeters" DOUBLE PRECISION,
  ADD COLUMN "shopName" TEXT,
  ADD COLUMN "revisitOfVisitId" TEXT,
  ADD COLUMN "boardPhotoPath" TEXT,
  ADD COLUMN "boardPhotoHash" TEXT,
  ADD COLUMN "boardPhotoTakenAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "durationSeconds" INTEGER,
  ADD COLUMN "spokeTo" TEXT,
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "outcomeReason" TEXT,
  ADD COLUMN "revisitOn" DATE,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "outcomeRecordedAt" TIMESTAMP(3),
  ADD COLUMN "proofLatitude" DOUBLE PRECISION,
  ADD COLUMN "proofLongitude" DOUBLE PRECISION,
  ADD COLUMN "proofAccuracyMeters" DOUBLE PRECISION,
  ADD COLUMN "proofAt" TIMESTAMP(3),
  ADD COLUMN "proofDistanceMeters" DOUBLE PRECISION,
  ADD COLUMN "gpsSuspect" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "BusinessVisit_boardPhotoHash_idx" ON "BusinessVisit"("boardPhotoHash");
CREATE INDEX "BusinessVisit_staffId_visitedAt_idx" ON "BusinessVisit"("staffId", "visitedAt");
CREATE INDEX "BusinessVisit_revisitOfVisitId_idx" ON "BusinessVisit"("revisitOfVisitId");
CREATE INDEX "BusinessVisit_revisitOn_idx" ON "BusinessVisit"("revisitOn");

-- Interview day: the field agent marks "candidate arrived", with GPS.
ALTER TABLE "Interview"
  ADD COLUMN "candidateArrivedAt" TIMESTAMP(3),
  ADD COLUMN "candidateArrivedByStaffId" TEXT,
  ADD COLUMN "candidateArrivedLatitude" DOUBLE PRECISION,
  ADD COLUMN "candidateArrivedLongitude" DOUBLE PRECISION,
  ADD COLUMN "candidateArrivedAccuracyMeters" DOUBLE PRECISION,
  ADD COLUMN "candidateArrivedDistanceMeters" DOUBLE PRECISION;

-- Settings for the Team Lead's shop-visit checks.
ALTER TABLE "PricingPolicy"
  ADD COLUMN "visitShortMinutes" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "visitMaxTravelKmh" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "visitSameSpotMeters" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "visitNoOnboardingCount" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN "visitNoOnboardingDays" INTEGER NOT NULL DEFAULT 7;

-- Idempotency-Key handling for the field app's offline queue.
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'processing',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdempotencyRecord_staffId_key_key" ON "IdempotencyRecord"("staffId", "key");
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");
ALTER TABLE "IdempotencyRecord" ENABLE ROW LEVEL SECURITY;
