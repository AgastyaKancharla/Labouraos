ALTER TABLE "Interview" ADD COLUMN "callRecordId" TEXT;

CREATE UNIQUE INDEX "Interview_callRecordId_key" ON "Interview"("callRecordId");

ALTER TABLE "Interview" ADD CONSTRAINT "Interview_callRecordId_fkey"
  FOREIGN KEY ("callRecordId") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
