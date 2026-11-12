-- C-Audit's Device column: the device and network every audit row was written from.
ALTER TABLE "AuditLog" ADD COLUMN "deviceId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "deviceName" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "network" TEXT;
