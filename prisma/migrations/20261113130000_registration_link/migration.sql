CREATE TABLE "KycServiceState" (
    "id" TEXT NOT NULL DEFAULT 'id-check',
    "status" TEXT NOT NULL DEFAULT 'up',
    "lastChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KycServiceState_pkey" PRIMARY KEY ("id")
);
INSERT INTO "KycServiceState" ("id", "status", "lastChangedAt", "updatedAt")
VALUES ('id-check', 'up', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE "KycRecoveryRequest" (
    "id" TEXT NOT NULL,
    "jobSeekerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "registrationLinkId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KycRecoveryRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KycRecoveryRequest_status_requestedAt_idx" ON "KycRecoveryRequest"("status", "requestedAt");
CREATE INDEX "KycRecoveryRequest_jobSeekerId_status_idx" ON "KycRecoveryRequest"("jobSeekerId", "status");
ALTER TABLE "KycRecoveryRequest" ADD CONSTRAINT "KycRecoveryRequest_jobSeekerId_fkey" FOREIGN KEY ("jobSeekerId") REFERENCES "JobSeeker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
