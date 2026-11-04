-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "noticeVersion" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "otpRequestId" TEXT,
    "grantedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Consent_subjectType_subjectId_purpose_noticeVersion_key" ON "Consent"("subjectType", "subjectId", "purpose", "noticeVersion");

-- CreateIndex
CREATE INDEX "Consent_subjectType_subjectId_idx" ON "Consent"("subjectType", "subjectId");
