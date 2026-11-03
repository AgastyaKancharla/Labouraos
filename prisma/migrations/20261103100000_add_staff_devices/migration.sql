-- CreateTable
CREATE TABLE "StaffDevice" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "approvedByStaffId" TEXT,
    "revokedByStaffId" TEXT,

    CONSTRAINT "StaffDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffDevice_staffId_deviceId_key" ON "StaffDevice"("staffId", "deviceId");

-- CreateIndex
CREATE INDEX "StaffDevice_staffId_idx" ON "StaffDevice"("staffId");

-- CreateIndex
CREATE INDEX "StaffDevice_status_idx" ON "StaffDevice"("status");

-- CreateIndex
CREATE INDEX "StaffDevice_approvedByStaffId_idx" ON "StaffDevice"("approvedByStaffId");

-- CreateIndex
CREATE INDEX "StaffDevice_revokedByStaffId_idx" ON "StaffDevice"("revokedByStaffId");

-- AddForeignKey
ALTER TABLE "StaffDevice" ADD CONSTRAINT "StaffDevice_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDevice" ADD CONSTRAINT "StaffDevice_approvedByStaffId_fkey" FOREIGN KEY ("approvedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDevice" ADD CONSTRAINT "StaffDevice_revokedByStaffId_fkey" FOREIGN KEY ("revokedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON COLUMN "Staff"."registeredDeviceId" IS 'deprecated — replaced by StaffDevice. Not removed until login stops reading it.';

-- Backfill existing registered devices
-- approvedByStaffId null means the row was migrated, not approved by a person.
INSERT INTO "StaffDevice" (
    "id",
    "staffId",
    "deviceId",
    "label",
    "platform",
    "status",
    "requestedAt",
    "approvedAt",
    "approvedByStaffId"
)
SELECT
    gen_random_uuid()::text,
    s."id",
    s."registeredDeviceId",
    'migrated',
    'unknown',
    'approved',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    NULL
FROM "Staff" s
WHERE s."registeredDeviceId" IS NOT NULL
  AND btrim(s."registeredDeviceId") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "StaffDevice" d
    WHERE d."staffId" = s."id" AND d."deviceId" = s."registeredDeviceId"
  );
