-- AlterTable
ALTER TABLE "ContactAttempt" ADD COLUMN "callRecordId" TEXT;
ALTER TABLE "ContactAttempt" ADD COLUMN "messageLogId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ContactAttempt_callRecordId_key" ON "ContactAttempt"("callRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAttempt_messageLogId_key" ON "ContactAttempt"("messageLogId");

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_callRecordId_fkey" FOREIGN KEY ("callRecordId") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_messageLogId_fkey" FOREIGN KEY ("messageLogId") REFERENCES "MessageLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
