-- CreateTable
CREATE TABLE "ReviewFlag" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "raisedForStaffId" TEXT,
    "details" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByStaffId" TEXT,
    "resolution" TEXT,

    CONSTRAINT "ReviewFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewFlag_code_key" ON "ReviewFlag"("code");

-- CreateIndex
CREATE INDEX "ReviewFlag_status_raisedAt_idx" ON "ReviewFlag"("status", "raisedAt");

-- CreateIndex
CREATE INDEX "ReviewFlag_raisedForStaffId_idx" ON "ReviewFlag"("raisedForStaffId");

-- AddForeignKey
ALTER TABLE "ReviewFlag" ADD CONSTRAINT "ReviewFlag_raisedForStaffId_fkey" FOREIGN KEY ("raisedForStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewFlag" ADD CONSTRAINT "ReviewFlag_resolvedByStaffId_fkey" FOREIGN KEY ("resolvedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
