-- AlterTable
ALTER TABLE "Placement"
  ADD COLUMN "joiningWorkerCallId" TEXT,
  ADD COLUMN "joiningBusinessCallId" TEXT;

-- CreateIndex
CREATE INDEX "Placement_joiningWorkerCallId_idx" ON "Placement"("joiningWorkerCallId");

-- CreateIndex
CREATE INDEX "Placement_joiningBusinessCallId_idx" ON "Placement"("joiningBusinessCallId");

-- AddForeignKey
ALTER TABLE "Placement"
  ADD CONSTRAINT "Placement_joiningWorkerCallId_fkey"
  FOREIGN KEY ("joiningWorkerCallId") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement"
  ADD CONSTRAINT "Placement_joiningBusinessCallId_fkey"
  FOREIGN KEY ("joiningBusinessCallId") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
