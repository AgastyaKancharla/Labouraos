-- Calls put back on an agent's list: "call me back" at a set time, and the
-- automatic retry after an unanswered call.
CREATE TABLE "CallTask" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "sourceCallRecordId" TEXT,
    "doneCallRecordId" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallTask_sourceCallRecordId_kind_key" ON "CallTask"("sourceCallRecordId", "kind");
CREATE INDEX "CallTask_staffId_status_dueAt_idx" ON "CallTask"("staffId", "status", "dueAt");
CREATE INDEX "CallTask_subjectType_subjectId_status_idx" ON "CallTask"("subjectType", "subjectId", "status");

ALTER TABLE "CallTask" ENABLE ROW LEVEL SECURITY;
