-- 21 Nov call agent fixes (Master Guide rev 202, "Call agent and field agent fixes"):
-- missed calls are handed out by the software (who and why, first call back),
-- and "wrong number" / "do not call" call results block retries and messages.
ALTER TABLE "CallbackTask" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "CallbackTask" ADD COLUMN "assignmentReason" TEXT;
ALTER TABLE "CallbackTask" ADD COLUMN "firstAttemptAt" TIMESTAMP(3);
ALTER TABLE "CallbackTask" ADD COLUMN "completedAt" TIMESTAMP(3);
CREATE INDEX "CallbackTask_assignedToStaffId_status_idx" ON "CallbackTask"("assignedToStaffId", "status");

CREATE TABLE "ContactBlock" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "callRecordId" TEXT,
    "byStaffId" TEXT,
    "liveKey" TEXT,
    "liftedAt" TIMESTAMP(3),
    "liftedByStaffId" TEXT,
    "liftReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContactBlock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContactBlock_liveKey_key" ON "ContactBlock"("liveKey");
CREATE INDEX "ContactBlock_subjectType_subjectId_idx" ON "ContactBlock"("subjectType", "subjectId");
ALTER TABLE "ContactBlock" ENABLE ROW LEVEL SECURITY;

-- Leave and no-show handover of every open call item (call tasks, missed calls,
-- people looked after, app sign-ups); follow-ups keep FollowUpHandover.
CREATE TABLE "WorkHandover" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "leaveRequestId" TEXT,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fromStaffId" TEXT NOT NULL,
    "toStaffId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL,
    "movedByStaffId" TEXT,
    "returnAfter" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkHandover_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkHandover_leaveRequestId_idx" ON "WorkHandover"("leaveRequestId");
CREATE INDEX "WorkHandover_fromStaffId_movedAt_idx" ON "WorkHandover"("fromStaffId", "movedAt");
CREATE INDEX "WorkHandover_returnedAt_returnAfter_idx" ON "WorkHandover"("returnedAt", "returnAfter");
ALTER TABLE "WorkHandover" ENABLE ROW LEVEL SECURITY;
