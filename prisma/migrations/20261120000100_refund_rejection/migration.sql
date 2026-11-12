-- FN-Refund "Reject": a refund decided not owed leaves the refund-due list for that guarantee.
CREATE TABLE "RefundRejection" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "jobSeekerId" TEXT,
    "guaranteeStartedAt" TIMESTAMP(3),
    "placementId" TEXT,
    "paymentId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "rejectedByStaffId" TEXT NOT NULL,
    "rejectedByRole" TEXT NOT NULL,
    "rejectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundRejection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RefundRejection_jobSeekerId_idx" ON "RefundRejection"("jobSeekerId");
CREATE INDEX "RefundRejection_placementId_idx" ON "RefundRejection"("placementId");

ALTER TABLE "RefundRejection" ENABLE ROW LEVEL SECURITY;
