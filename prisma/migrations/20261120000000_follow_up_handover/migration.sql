-- T-Req-Sneha: a leave approval hands the person's follow-ups on those days to teammates.
CREATE TABLE "FollowUpHandover" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "followUpTaskId" TEXT NOT NULL,
    "fromStaffId" TEXT NOT NULL,
    "toStaffId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedByStaffId" TEXT NOT NULL,
    "returnAfter" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "returnOutcome" TEXT,

    CONSTRAINT "FollowUpHandover_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FollowUpHandover_leaveRequestId_idx" ON "FollowUpHandover"("leaveRequestId");
CREATE INDEX "FollowUpHandover_followUpTaskId_idx" ON "FollowUpHandover"("followUpTaskId");
CREATE INDEX "FollowUpHandover_returnedAt_returnAfter_idx" ON "FollowUpHandover"("returnedAt", "returnAfter");

ALTER TABLE "FollowUpHandover" ENABLE ROW LEVEL SECURITY;
