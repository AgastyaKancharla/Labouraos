-- Requests and escalation (Team Lead and Manager portals): one requests model
-- for everything a Team Lead or Manager decides. Leave, corrections, devices
-- and replacement claims keep their own tables; StaffRequest holds the kinds
-- that had none (hit removal, target change, day change, written warning).
CREATE TABLE "StaffRequest" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "requestedByStaffId" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "routedToRole" TEXT NOT NULL,
  "routedToStaffId" TEXT,
  "routeReason" TEXT NOT NULL,
  "forwardedAt" TIMESTAMP(3),
  "forwardedByStaffId" TEXT,
  "forwardNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decidedByStaffId" TEXT,
  "decidedByRole" TEXT,
  "decisionReason" TEXT,
  "overturnedAt" TIMESTAMP(3),
  "overturnedByStaffId" TEXT,
  "overturnReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffRequest_status_routedToRole_idx" ON "StaffRequest"("status", "routedToRole");
CREATE INDEX "StaffRequest_staffId_status_idx" ON "StaffRequest"("staffId", "status");
CREATE INDEX "StaffRequest_kind_subjectId_idx" ON "StaffRequest"("kind", "subjectId");
CREATE INDEX "StaffRequest_decidedAt_idx" ON "StaffRequest"("decidedAt");
ALTER TABLE "StaffRequest" ENABLE ROW LEVEL SECURITY;

-- Review flags get an owner: who decides the flag now. "Send to Manager"
-- (Team Lead) and "Send to CEO" (Manager) move it up; money and bypass flags
-- always belong to the CEO.
ALTER TABLE "ReviewFlag"
  ADD COLUMN "ownerRole" TEXT,
  ADD COLUMN "ownerStaffId" TEXT,
  ADD COLUMN "escalatedAt" TIMESTAMP(3),
  ADD COLUMN "escalatedByStaffId" TEXT,
  ADD COLUMN "escalationNote" TEXT;
CREATE INDEX "ReviewFlag_ownerRole_status_idx" ON "ReviewFlag"("ownerRole", "status");
UPDATE "ReviewFlag" SET "ownerRole" = 'ceo'
WHERE "kind" IN ('payment_overdue', 'payment_mismatch', 'payout_name_mismatch', 'payout_shared_account', 'payout_matches_staff', 'bypass_suspected');
