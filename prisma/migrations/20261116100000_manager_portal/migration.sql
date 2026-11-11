-- Manager portal: interns and start dates on "Add a staff member", password
-- resets that work like a new invite link, and coaching notes / written warnings.

ALTER TABLE "Staff" ADD COLUMN "isIntern" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Staff" ADD COLUMN "startsOn" DATE;

-- CreateTable
CREATE TABLE "StaffPasswordReset" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "issuedByStaffId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPasswordReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffPasswordReset_tokenHash_key" ON "StaffPasswordReset"("tokenHash");
CREATE INDEX "StaffPasswordReset_staffId_createdAt_idx" ON "StaffPasswordReset"("staffId", "createdAt");
CREATE INDEX "StaffPasswordReset_issuedByStaffId_idx" ON "StaffPasswordReset"("issuedByStaffId");

ALTER TABLE "StaffPasswordReset" ADD CONSTRAINT "StaffPasswordReset_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffPasswordReset" ADD CONSTRAINT "StaffPasswordReset_issuedByStaffId_fkey" FOREIGN KEY ("issuedByStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StaffPasswordReset" ENABLE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "StaffCoachingNote" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "authorStaffId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCoachingNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffCoachingNote_staffId_createdAt_idx" ON "StaffCoachingNote"("staffId", "createdAt");

ALTER TABLE "StaffCoachingNote" ADD CONSTRAINT "StaffCoachingNote_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffCoachingNote" ADD CONSTRAINT "StaffCoachingNote_authorStaffId_fkey" FOREIGN KEY ("authorStaffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StaffCoachingNote" ENABLE ROW LEVEL SECURITY;
