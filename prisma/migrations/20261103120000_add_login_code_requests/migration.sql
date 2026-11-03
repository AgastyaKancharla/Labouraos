-- CreateTable
CREATE TABLE "LoginCodeRequest" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffDeviceId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "onOfficeNetwork" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revealedByStaffId" TEXT,
    "revealedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "refusedByStaffId" TEXT,
    "refusedReason" TEXT,

    CONSTRAINT "LoginCodeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginCodeRequest_staffId_status_idx" ON "LoginCodeRequest"("staffId", "status");

-- CreateIndex
CREATE INDEX "LoginCodeRequest_createdAt_idx" ON "LoginCodeRequest"("createdAt");

-- CreateIndex
CREATE INDEX "LoginCodeRequest_expiresAt_idx" ON "LoginCodeRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "LoginCodeRequest_revealedByStaffId_idx" ON "LoginCodeRequest"("revealedByStaffId");

-- CreateIndex
CREATE INDEX "LoginCodeRequest_refusedByStaffId_idx" ON "LoginCodeRequest"("refusedByStaffId");

-- AddForeignKey
ALTER TABLE "LoginCodeRequest" ADD CONSTRAINT "LoginCodeRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginCodeRequest" ADD CONSTRAINT "LoginCodeRequest_staffDeviceId_fkey" FOREIGN KEY ("staffDeviceId") REFERENCES "StaffDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginCodeRequest" ADD CONSTRAINT "LoginCodeRequest_revealedByStaffId_fkey" FOREIGN KEY ("revealedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginCodeRequest" ADD CONSTRAINT "LoginCodeRequest_refusedByStaffId_fkey" FOREIGN KEY ("refusedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
