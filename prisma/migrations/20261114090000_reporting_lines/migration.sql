-- Phase 21 Task 1: one reporting line for everyone.
-- teamLeadId stays. Existing agent links are copied into reportsToId.
-- A later phase removes teamLeadId; until then both are written together.

ALTER TABLE "Staff" ADD COLUMN "reportsToId" TEXT;

UPDATE "Staff"
SET "reportsToId" = "teamLeadId"
WHERE "reportsToId" IS NULL
  AND "teamLeadId" IS NOT NULL;

CREATE INDEX "Staff_reportsToId_idx" ON "Staff"("reportsToId");

ALTER TABLE "Staff" ADD CONSTRAINT "Staff_reportsToId_fkey"
  FOREIGN KEY ("reportsToId") REFERENCES "Staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
