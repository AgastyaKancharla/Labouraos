-- The agent who registered a referral partner. A Team Lead reads only partners
-- their team registered. Older partners keep null: the CEO and Managers see them.
ALTER TABLE "Referral" ADD COLUMN "registeredByStaffId" TEXT;
CREATE INDEX "Referral_registeredByStaffId_idx" ON "Referral"("registeredByStaffId");
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_registeredByStaffId_fkey" FOREIGN KEY ("registeredByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
