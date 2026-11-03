-- AlterTable
ALTER TABLE "Staff" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Staff" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "Staff" ADD COLUMN "lockedByStaffId" TEXT;
ALTER TABLE "Staff" ADD COLUMN "lockedReason" TEXT;

-- AlterTable
ALTER TABLE "StaffSession" ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "StaffSession" ADD COLUMN "absoluteExpiresAt" TIMESTAMP(3);
ALTER TABLE "StaffSession" ADD COLUMN "endedReason" TEXT;
ALTER TABLE "StaffSession" ADD COLUMN "loginCodeRequestId" TEXT;

UPDATE "StaffSession" SET "absoluteExpiresAt" = "expiresAt" WHERE "absoluteExpiresAt" IS NULL;
ALTER TABLE "StaffSession" ALTER COLUMN "absoluteExpiresAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Staff_lockedByStaffId_idx" ON "Staff"("lockedByStaffId");
CREATE INDEX "StaffSession_loginCodeRequestId_idx" ON "StaffSession"("loginCodeRequestId");

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_lockedByStaffId_fkey" FOREIGN KEY ("lockedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_loginCodeRequestId_fkey" FOREIGN KEY ("loginCodeRequestId") REFERENCES "LoginCodeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
