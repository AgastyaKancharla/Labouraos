-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "inviteExpiresAt" TIMESTAMP(3),
ADD COLUMN     "inviteTokenHash" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE UNIQUE INDEX "Staff_inviteTokenHash_key" ON "Staff"("inviteTokenHash");

