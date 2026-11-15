-- Legal documents v1.1 (Master Guide rev 176, 15 Nov): versioned acceptances
-- with the exact text, company / Grievance Officer settings, D2 never-joined
-- replacements, D3 salary-upgrade difference, D6 business suspension and D11
-- permanent bans.

ALTER TABLE "JobSeeker" ADD COLUMN "termsAcceptedVersion" TEXT;
ALTER TABLE "JobSeeker" ADD COLUMN "termsAcceptedLanguage" TEXT;
ALTER TABLE "JobSeeker" ADD COLUMN "termsAcceptedHash" TEXT;

ALTER TABLE "Placement" ADD COLUMN "countsAsReplacement" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Placement" ADD COLUMN "replacedSalaryPaise" INTEGER;
ALTER TABLE "Placement" ADD COLUMN "salaryUpgradeDifferencePaise" INTEGER;
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_salaryUpgradeDifferencePaise_check" CHECK ("salaryUpgradeDifferencePaise" IS NULL OR "salaryUpgradeDifferencePaise" > 0);

ALTER TABLE "Business" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "suspendedUntil" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "suspendedByStaffId" TEXT;
ALTER TABLE "Business" ADD COLUMN "suspensionReason" TEXT;

ALTER TABLE "PricingPolicy" ADD COLUMN "companyCin" TEXT;
ALTER TABLE "PricingPolicy" ADD COLUMN "grievanceOfficerName" TEXT;
ALTER TABLE "PricingPolicy" ADD COLUMN "grievanceOfficerPhone" TEXT;
ALTER TABLE "PricingPolicy" ADD COLUMN "grievanceOfficerEmail" TEXT;
-- M2 (rev 178): an unpaid replacement salary-difference request is cancelled after this many days.
ALTER TABLE "PricingPolicy" ADD COLUMN "upgradePaymentCancelDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "PricingPolicy" ADD CONSTRAINT "PricingPolicy_upgradePaymentCancelDays_check" CHECK ("upgradePaymentCancelDays" BETWEEN 1 AND 30);

-- M10 (rev 178): the 15-day replacement clock pauses while the business is suspended.
ALTER TABLE "ReplacementClaim" ADD COLUMN "clockPausedAt" TIMESTAMP(3);
ALTER TABLE "ReplacementClaim" ADD COLUMN "clockPausedSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReplacementClaim" ADD CONSTRAINT "ReplacementClaim_clockPausedSeconds_check" CHECK ("clockPausedSeconds" >= 0);

CREATE TABLE "LegalDocumentText" (
    "hash" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalDocumentText_pkey" PRIMARY KEY ("hash")
);

CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "otpRequestId" TEXT,
    "noticeVersion" TEXT,
    "purposes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LegalAcceptance_subjectType_subjectId_documentKey_idx" ON "LegalAcceptance"("subjectType", "subjectId", "documentKey");
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_textHash_fkey" FOREIGN KEY ("textHash") REFERENCES "LegalDocumentText"("hash") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PermanentBan" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectCode" TEXT,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "idFingerprints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bannedByStaffId" TEXT NOT NULL,
    "bannedAt" TIMESTAMP(3) NOT NULL,
    "coveredProfiles" JSONB NOT NULL DEFAULT '[]',
    "liftedAt" TIMESTAMP(3),
    "liftedByStaffId" TEXT,
    "liftReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PermanentBan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PermanentBan_subjectType_subjectId_idx" ON "PermanentBan"("subjectType", "subjectId");
-- One live ban per profile; a lifted ban stays as history (M7, rev 178).
CREATE UNIQUE INDEX "PermanentBan_live_subject_key" ON "PermanentBan"("subjectType", "subjectId") WHERE "liftedAt" IS NULL;
ALTER TABLE "PermanentBan" ADD CONSTRAINT "PermanentBan_lift_check" CHECK ("liftedAt" IS NULL OR ("liftedByStaffId" IS NOT NULL AND "liftReason" IS NOT NULL));
CREATE INDEX "PermanentBan_phoneHash_idx" ON "PermanentBan"("phoneHash");
ALTER TABLE "PermanentBan" ADD CONSTRAINT "PermanentBan_category_check" CHECK ("category" IN ('forged_id', 'fraud', 'theft', 'violence'));

-- Supabase's Data API must expose nothing: row level security on, no policies (the API connects as the owner).
ALTER TABLE "LegalDocumentText" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalAcceptance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PermanentBan" ENABLE ROW LEVEL SECURITY;
