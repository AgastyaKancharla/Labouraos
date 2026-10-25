-- CreateTable
CREATE TABLE "CallbackTask" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "callerName" TEXT,
    "virtualNumber" TEXT NOT NULL DEFAULT '18001234567',
    "jobSeekerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assignedToStaffId" TEXT,
    "recordingUrl" TEXT,
    "recordingConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallbackTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallbackTask_callId_key" ON "CallbackTask"("callId");

-- CreateIndex
CREATE INDEX "CallbackTask_phone_idx" ON "CallbackTask"("phone");

-- CreateIndex
CREATE INDEX "CallbackTask_status_idx" ON "CallbackTask"("status");

-- CreateIndex
CREATE INDEX "CallbackTask_createdAt_idx" ON "CallbackTask"("createdAt");

-- AddForeignKey
ALTER TABLE "CallbackTask" ADD CONSTRAINT "CallbackTask_jobSeekerId_fkey" FOREIGN KEY ("jobSeekerId") REFERENCES "JobSeeker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallbackTask" ADD CONSTRAINT "CallbackTask_assignedToStaffId_fkey" FOREIGN KEY ("assignedToStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
