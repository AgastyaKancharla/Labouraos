-- 21 Nov (Master Guide rev 202): inbound WhatsApp conversations as tracked leads,
-- referral partner share links and the leads partners send.

ALTER TABLE "Referral" ADD COLUMN "shareSlug" TEXT;
CREATE UNIQUE INDEX "Referral_shareSlug_key" ON "Referral"("shareSlug");

CREATE TABLE "WhatsAppConversation" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "profileName" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedStaffId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "assignmentReason" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "waitingSince" TIMESTAMP(3),
    "waitingWorkSeconds" INTEGER NOT NULL DEFAULT 0,
    "waitCountedAt" TIMESTAMP(3),
    "teamLeadAlertedAt" TIMESTAMP(3),
    "managerAlertedAt" TIMESTAMP(3),
    "autoReplyAt" TIMESTAMP(3),
    "outcome" TEXT,
    "outcomeNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByStaffId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConversation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppConversation_phone_key" ON "WhatsAppConversation"("phone");
CREATE INDEX "WhatsAppConversation_status_assignedStaffId_idx" ON "WhatsAppConversation"("status", "assignedStaffId");
CREATE INDEX "WhatsAppConversation_subjectType_subjectId_idx" ON "WhatsAppConversation"("subjectType", "subjectId");
ALTER TABLE "WhatsAppConversation" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "templateName" TEXT,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "sentByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppMessage_providerMessageId_key" ON "WhatsAppMessage"("providerMessageId");
CREATE INDEX "WhatsAppMessage_conversationId_createdAt_idx" ON "WhatsAppMessage"("conversationId", "createdAt");
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppMessage" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "ReferralLead" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "lookingFor" TEXT NOT NULL,
    "area" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL,
    "customerLeadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedStaffId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "outcomeNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByStaffId" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralLead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReferralLead_customerLeadId_key" ON "ReferralLead"("customerLeadId");
CREATE INDEX "ReferralLead_referralId_idx" ON "ReferralLead"("referralId");
CREATE INDEX "ReferralLead_status_assignedStaffId_idx" ON "ReferralLead"("status", "assignedStaffId");
CREATE INDEX "ReferralLead_phone_idx" ON "ReferralLead"("phone");
ALTER TABLE "ReferralLead" ENABLE ROW LEVEL SECURITY;
