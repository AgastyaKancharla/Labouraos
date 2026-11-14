-- Customer sessions: remember the refresh token before the last renewal, so a
-- copied (reused) refresh token ends the session.
ALTER TABLE "CustomerSession" ADD COLUMN "previousRefreshTokenHash" TEXT;
CREATE UNIQUE INDEX "CustomerSession_previousRefreshTokenHash_key" ON "CustomerSession"("previousRefreshTokenHash");
