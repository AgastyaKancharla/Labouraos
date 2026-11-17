-- Team Lead portal (Master Guide rev 194, "Team Lead portal, decided 17 Nov"): a Team Lead can
-- assign a job seeker or a referral partner to himself or an agent of his team. The assigned agent
-- counts as an owner for team scope; registeredByStaffId (registration credit, the self-approval
-- rule) never changes. Columns on existing tables: their RLS stays as it is.
ALTER TABLE "JobSeeker" ADD COLUMN "assignedStaffId" TEXT;
ALTER TABLE "JobSeeker" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "Referral" ADD COLUMN "assignedStaffId" TEXT;
ALTER TABLE "Referral" ADD COLUMN "assignedAt" TIMESTAMP(3);

CREATE INDEX "JobSeeker_assignedStaffId_idx" ON "JobSeeker"("assignedStaffId");
CREATE INDEX "Referral_assignedStaffId_idx" ON "Referral"("assignedStaffId");

ALTER TABLE "JobSeeker" ADD CONSTRAINT "JobSeeker_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_assignedStaffId_fkey" FOREIGN KEY ("assignedStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
