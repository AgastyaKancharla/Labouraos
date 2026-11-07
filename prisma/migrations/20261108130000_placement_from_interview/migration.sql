ALTER TABLE "Placement"
  ADD COLUMN "interviewId" TEXT,
  ADD COLUMN "selectedAt" TIMESTAMP(3),
  ADD COLUMN "paymentDueAt" TIMESTAMP(3),
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "joiningDate" TIMESTAMP(3),
  ADD COLUMN "rootPlacementId" TEXT,
  ADD COLUMN "replacementNumber" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "feePercentAtCreation" INTEGER,
  ADD COLUMN "gstPercentAtCreation" INTEGER,
  ADD COLUMN "guaranteeEndedReason" TEXT;

CREATE UNIQUE INDEX "Placement_interviewId_key" ON "Placement"("interviewId");

ALTER TABLE "Placement" ALTER COLUMN "status" SET DEFAULT 'awaiting_payment';

ALTER TABLE "Placement"
  ADD CONSTRAINT "Placement_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
