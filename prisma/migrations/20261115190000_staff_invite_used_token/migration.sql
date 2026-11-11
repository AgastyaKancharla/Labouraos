-- The invite page tells a new hire whether their link is not valid, expired
-- or already used. Only the SHA-256 of the redeemed token is kept.
ALTER TABLE "Staff" ADD COLUMN "inviteUsedTokenHash" TEXT;
CREATE UNIQUE INDEX "Staff_inviteUsedTokenHash_key" ON "Staff"("inviteUsedTokenHash");
