-- Register of data requests under India's data law (C-Privacy): access,
-- correction and erasure requests from job seekers, businesses and referral
-- partners, each with who logged it, status, due date, outcome and closing.

CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectCode" TEXT NOT NULL,
    "details" TEXT,
    "receivedOn" DATE NOT NULL,
    "dueOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "outcome" TEXT,
    "outcomeNote" TEXT,
    "loggedByStaffId" TEXT NOT NULL,
    "updatedByStaffId" TEXT,
    "closedByStaffId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataRequest_code_key" ON "DataRequest"("code");
CREATE INDEX "DataRequest_status_dueOn_idx" ON "DataRequest"("status", "dueOn");
CREATE INDEX "DataRequest_subjectType_subjectId_idx" ON "DataRequest"("subjectType", "subjectId");

ALTER TABLE "DataRequest" ENABLE ROW LEVEL SECURITY;
