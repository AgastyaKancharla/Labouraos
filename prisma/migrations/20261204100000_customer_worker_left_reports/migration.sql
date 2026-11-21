-- Customer app: "A worker left" reports from businesses (customer-only table).
-- Not the replacement claim: the call team calls the owner and files the claim.
CREATE TABLE "CustomerWorkerLeftReport" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "profileId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "placementId" TEXT NOT NULL,
    "workerLeftOn" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "callbackRequestId" TEXT,
    "claimId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerWorkerLeftReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerWorkerLeftReport_placementId_status_idx" ON "CustomerWorkerLeftReport"("placementId", "status");
CREATE INDEX "CustomerWorkerLeftReport_status_createdAt_idx" ON "CustomerWorkerLeftReport"("status", "createdAt");
CREATE INDEX "CustomerWorkerLeftReport_accountId_idx" ON "CustomerWorkerLeftReport"("accountId");
-- At most one open report per placement (two taps never make two).
CREATE UNIQUE INDEX "CustomerWorkerLeftReport_one_open_per_placement" ON "CustomerWorkerLeftReport"("placementId") WHERE "status" = 'open';
ALTER TABLE "CustomerWorkerLeftReport" ADD CONSTRAINT "CustomerWorkerLeftReport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerWorkerLeftReport" ENABLE ROW LEVEL SECURITY;
