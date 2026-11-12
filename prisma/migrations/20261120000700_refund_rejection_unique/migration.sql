-- R4 (12 Nov): one rejection per job seeker guarantee and per placement chain.
DROP INDEX IF EXISTS "RefundRejection_placementId_idx";
CREATE UNIQUE INDEX "RefundRejection_placementId_key" ON "RefundRejection"("placementId");
CREATE UNIQUE INDEX "RefundRejection_jobSeekerId_guaranteeStartedAt_key" ON "RefundRejection"("jobSeekerId", "guaranteeStartedAt");
