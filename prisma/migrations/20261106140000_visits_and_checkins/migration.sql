ALTER TABLE "BusinessVisit"
  ADD COLUMN "purpose" TEXT,
  ADD COLUMN "ownerOtpRequestId" TEXT,
  ADD COLUMN "photoLive" BOOLEAN,
  ADD COLUMN "assignmentId" TEXT;

CREATE TABLE "VisitAssignment" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "suggestedStaffId" TEXT,
  "assignedStaffId" TEXT,
  "assignedByStaffId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "relatedType" TEXT,
  "relatedId" TEXT,
  "visitId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisitAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FieldCheckIn" (
  "id" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracyMeters" DOUBLE PRECISION NOT NULL,
  "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FieldCheckIn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitAssignment_visitId_key" ON "VisitAssignment"("visitId");
CREATE INDEX "VisitAssignment_businessId_status_idx" ON "VisitAssignment"("businessId", "status");
CREATE INDEX "VisitAssignment_assignedStaffId_status_idx" ON "VisitAssignment"("assignedStaffId", "status");
CREATE INDEX "FieldCheckIn_staffId_checkedInAt_idx" ON "FieldCheckIn"("staffId", "checkedInAt");
CREATE INDEX "BusinessVisit_assignmentId_idx" ON "BusinessVisit"("assignmentId");

ALTER TABLE "VisitAssignment"
  ADD CONSTRAINT "VisitAssignment_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitAssignment"
  ADD CONSTRAINT "VisitAssignment_suggestedStaffId_fkey"
  FOREIGN KEY ("suggestedStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitAssignment"
  ADD CONSTRAINT "VisitAssignment_assignedStaffId_fkey"
  FOREIGN KEY ("assignedStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitAssignment"
  ADD CONSTRAINT "VisitAssignment_assignedByStaffId_fkey"
  FOREIGN KEY ("assignedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitAssignment"
  ADD CONSTRAINT "VisitAssignment_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "BusinessVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessVisit"
  ADD CONSTRAINT "BusinessVisit_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "VisitAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FieldCheckIn"
  ADD CONSTRAINT "FieldCheckIn_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
