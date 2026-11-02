-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "reason" TEXT,
ADD COLUMN "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
