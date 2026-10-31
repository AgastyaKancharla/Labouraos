-- CreateIndex
CREATE INDEX "JobSeeker_status_paymentReceivedAt_idx" ON "JobSeeker"("status", "paymentReceivedAt");

-- CreateIndex
CREATE INDEX "Placement_status_eligibility_idx" ON "Placement"("status", "eligibility");

-- CreateIndex
CREATE INDEX "Payment_jobSeekerId_type_idx" ON "Payment"("jobSeekerId", "type");

-- CreateIndex
CREATE INDEX "Payment_placementId_type_idx" ON "Payment"("placementId", "type");

-- CreateIndex
CREATE INDEX "JobSeekerHit_jobSeekerId_reason_idx" ON "JobSeekerHit"("jobSeekerId", "reason");
