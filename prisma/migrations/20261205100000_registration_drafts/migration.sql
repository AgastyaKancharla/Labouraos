-- Unfinished registrations in the call agent console (Master Guide rev 204, 21 Nov).
CREATE TABLE "RegistrationDraft" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "verifiedPhone" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RegistrationDraft_staffId_kind_key" ON "RegistrationDraft"("staffId", "kind");
CREATE INDEX "RegistrationDraft_updatedAt_idx" ON "RegistrationDraft"("updatedAt");

ALTER TABLE "RegistrationDraft" ENABLE ROW LEVEL SECURITY;
