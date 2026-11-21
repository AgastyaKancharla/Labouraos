-- 21 Nov field agent fixes (Builder C).
ALTER TABLE "Business" ADD COLUMN "fieldVerifiedAt" TIMESTAMP(3);
ALTER TABLE "BusinessVisit" ADD COLUMN "revisitTime" TEXT;

CREATE TABLE "FieldHandover" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "businessId" TEXT,
    "fromStaffId" TEXT NOT NULL,
    "toStaffId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "leaveRequestId" TEXT,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "FieldHandover_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FieldHandover_toStaffId_kind_endedAt_idx" ON "FieldHandover"("toStaffId", "kind", "endedAt");
CREATE INDEX "FieldHandover_fromStaffId_kind_endedAt_idx" ON "FieldHandover"("fromStaffId", "kind", "endedAt");
CREATE INDEX "FieldHandover_kind_recordId_idx" ON "FieldHandover"("kind", "recordId");
CREATE INDEX "FieldHandover_businessId_idx" ON "FieldHandover"("businessId");

ALTER TABLE "FieldHandover" ENABLE ROW LEVEL SECURITY;
