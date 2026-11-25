-- WhatsApp first, SMS as backup (Master Guide rev 211, 25 Nov).

-- The SMS backup of a WhatsApp message (not delivered within 1 working hour, or failed).
ALTER TABLE "MessageLog" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN "smsBackup" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN "smsBackupDueAt" TIMESTAMP(3);
ALTER TABLE "MessageLog" ADD COLUMN "smsBackupPayload" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN "smsBackupMessageLogId" TEXT;
CREATE INDEX "MessageLog_smsBackup_smsBackupDueAt_idx" ON "MessageLog"("smsBackup", "smsBackupDueAt");

-- Numbers that cannot get WhatsApp ("No WhatsApp").
CREATE TABLE "NoWhatsAppPhone" (
    "id" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "phoneLast4" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "errorCode" TEXT,
    "markedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NoWhatsAppPhone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NoWhatsAppPhone_phoneHash_key" ON "NoWhatsAppPhone"("phoneHash");
ALTER TABLE "NoWhatsAppPhone" ENABLE ROW LEVEL SECURITY;

-- Login and confirmation codes on WhatsApp (Authentication template), SMS as backup.
ALTER TABLE "OtpSession" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'sms';
ALTER TABLE "OtpSession" ADD COLUMN "codeHash" TEXT;
ALTER TABLE "OtpSession" ADD COLUMN "smsRequestId" TEXT;
ALTER TABLE "OtpSession" ADD COLUMN "whatsappMessageId" TEXT;
CREATE UNIQUE INDEX "OtpSession_whatsappMessageId_key" ON "OtpSession"("whatsappMessageId");
