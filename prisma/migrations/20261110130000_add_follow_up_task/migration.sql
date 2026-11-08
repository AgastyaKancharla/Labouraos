-- AlterTable PricingPolicy
ALTER TABLE "PricingPolicy" ADD COLUMN "followUpGraceDays" INTEGER NOT NULL DEFAULT 2;

-- CreateTable FollowUpTask
CREATE TABLE "FollowUpTask" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "assignedStaffId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "callRecordId" TEXT,
    "completedAt" TIMESTAMP(3),
    "answer" TEXT,
    "answerBusinessId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpTask_code_key" ON "FollowUpTask"("code");
CREATE INDEX "FollowUpTask_status_dueAt_idx" ON "FollowUpTask"("status", "dueAt");
CREATE INDEX "FollowUpTask_subjectType_subjectId_idx" ON "FollowUpTask"("subjectType", "subjectId");
CREATE INDEX "FollowUpTask_assignedStaffId_idx" ON "FollowUpTask"("assignedStaffId");
CREATE INDEX "FollowUpTask_kind_idx" ON "FollowUpTask"("kind");

-- AddForeignKey
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_callRecordId_fkey" FOREIGN KEY ("callRecordId") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_answerBusinessId_fkey" FOREIGN KEY ("answerBusinessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
