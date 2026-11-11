-- Codes sent from the public pages, so sends can be limited per link and per phone.
CREATE TABLE "PublicOtpSend" (
    "id" TEXT NOT NULL,
    "linkKey" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicOtpSend_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicOtpSend_linkKey_sentAt_idx" ON "PublicOtpSend"("linkKey", "sentAt");
CREATE INDEX "PublicOtpSend_phoneHash_sentAt_idx" ON "PublicOtpSend"("phoneHash", "sentAt");

ALTER TABLE "PublicOtpSend" ENABLE ROW LEVEL SECURITY;
