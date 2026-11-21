-- 21 Nov fixes (leave): the Team Lead's handover choice is recorded at approval; the work moves
-- when the leave starts (call-work sweep), not at approval.
CREATE TABLE "WorkHandoverPlan" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "toStaffId" TEXT,
    "decidedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkHandoverPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkHandoverPlan_leaveRequestId_key" ON "WorkHandoverPlan"("leaveRequestId");
CREATE INDEX "WorkHandoverPlan_staffId_idx" ON "WorkHandoverPlan"("staffId");
ALTER TABLE "WorkHandoverPlan" ENABLE ROW LEVEL SECURITY;
