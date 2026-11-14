-- Customer app foundation (customer app proposal, confirmed 14 Nov): a separate
-- sign-in realm for job seekers, businesses and referral partners, the sign-up
-- tracker the back office works from, the customer inbox and settings, and the
-- small additions to existing tables. Every new table has row level security on.

-- Staff: languages spoken with customers (sign-up help goes to someone who speaks theirs).
ALTER TABLE "Staff" ADD COLUMN "spokenLanguages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Call tasks: the new kind "signup_help" points at its sign-up.
ALTER TABLE "CallTask" ADD COLUMN "signupTrackerId" TEXT;
CREATE INDEX "CallTask_signupTrackerId_idx" ON "CallTask"("signupTrackerId");

-- Visit requests: the new purpose "business_signup" carries the owner's chosen time.
ALTER TABLE "VisitAssignment" ADD COLUMN "requestedFor" TIMESTAMP(3);
ALTER TABLE "VisitAssignment" ADD COLUMN "signupTrackerId" TEXT;
CREATE INDEX "VisitAssignment_signupTrackerId_idx" ON "VisitAssignment"("signupTrackerId");

-- CustomerAccount
CREATE TABLE "CustomerAccount" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "email" TEXT,
    "displayName" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "contactMeConsent" BOOLEAN NOT NULL DEFAULT false,
    "contactMeConsentAt" TIMESTAMP(3),
    "contactMeNoticeVersion" TEXT,
    "createdVia" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastProfileId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerAccount_phone_key" ON "CustomerAccount"("phone");
CREATE INDEX "CustomerAccount_status_idx" ON "CustomerAccount"("status");
CREATE INDEX "CustomerAccount_createdAt_idx" ON "CustomerAccount"("createdAt");
ALTER TABLE "CustomerAccount" ENABLE ROW LEVEL SECURITY;

-- CustomerIdentity
CREATE TABLE "CustomerIdentity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerIdentity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerIdentity_provider_subject_key" ON "CustomerIdentity"("provider", "subject");
CREATE INDEX "CustomerIdentity_accountId_idx" ON "CustomerIdentity"("accountId");
ALTER TABLE "CustomerIdentity" ADD CONSTRAINT "CustomerIdentity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerIdentity" ENABLE ROW LEVEL SECURITY;

-- CustomerProfile
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "jobSeekerId" TEXT,
    "referralId" TEXT,
    "businessId" TEXT,
    "branchId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'self',
    "linkedVia" TEXT NOT NULL,
    "invitedByAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerProfile_jobSeekerId_key" ON "CustomerProfile"("jobSeekerId");
CREATE UNIQUE INDEX "CustomerProfile_referralId_key" ON "CustomerProfile"("referralId");
CREATE INDEX "CustomerProfile_accountId_status_idx" ON "CustomerProfile"("accountId", "status");
CREATE INDEX "CustomerProfile_businessId_status_idx" ON "CustomerProfile"("businessId", "status");
CREATE INDEX "CustomerProfile_branchId_idx" ON "CustomerProfile"("branchId");
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_jobSeekerId_fkey" FOREIGN KEY ("jobSeekerId") REFERENCES "JobSeeker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "BusinessBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerProfile" ENABLE ROW LEVEL SECURITY;

-- CustomerDevice
CREATE TABLE "CustomerDevice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "pushToken" TEXT,
    "pushTokenUpdatedAt" TIMESTAMP(3),
    "pushPermission" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerDevice_pushToken_key" ON "CustomerDevice"("pushToken");
CREATE UNIQUE INDEX "CustomerDevice_accountId_installationId_key" ON "CustomerDevice"("accountId", "installationId");
CREATE INDEX "CustomerDevice_lastSeenAt_idx" ON "CustomerDevice"("lastSeenAt");
ALTER TABLE "CustomerDevice" ADD CONSTRAINT "CustomerDevice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerDevice" ENABLE ROW LEVEL SECURITY;

-- CustomerSession
CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "deviceId" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "signedInWith" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stepUpAt" TIMESTAMP(3),
    "stepUpPurpose" TEXT,
    "revokedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerSession_refreshTokenHash_key" ON "CustomerSession"("refreshTokenHash");
CREATE INDEX "CustomerSession_accountId_revokedAt_idx" ON "CustomerSession"("accountId", "revokedAt");
CREATE INDEX "CustomerSession_expiresAt_idx" ON "CustomerSession"("expiresAt");
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "CustomerDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerSession" ENABLE ROW LEVEL SECURITY;

-- CustomerOtpAttempt
CREATE TABLE "CustomerOtpAttempt" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "phoneHash" TEXT,
    "ipHash" TEXT,
    "deviceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOtpAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerOtpAttempt_phoneHash_createdAt_idx" ON "CustomerOtpAttempt"("phoneHash", "createdAt");
CREATE INDEX "CustomerOtpAttempt_ipHash_createdAt_idx" ON "CustomerOtpAttempt"("ipHash", "createdAt");
CREATE INDEX "CustomerOtpAttempt_deviceHash_createdAt_idx" ON "CustomerOtpAttempt"("deviceHash", "createdAt");
CREATE INDEX "CustomerOtpAttempt_createdAt_idx" ON "CustomerOtpAttempt"("createdAt");
ALTER TABLE "CustomerOtpAttempt" ENABLE ROW LEVEL SECURITY;

-- SignupTracker
CREATE TABLE "SignupTracker" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "profileKind" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'A',
    "stageReachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stuckReason" TEXT,
    "source" TEXT,
    "sourceDetail" TEXT,
    "referralCode" TEXT,
    "language" TEXT,
    "contactConsent" BOOLEAN NOT NULL DEFAULT false,
    "assignedStaffId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "assignmentReason" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "callTries" INTEGER NOT NULL DEFAULT 0,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL DEFAULT 'open',
    "finishedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupTracker_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SignupTracker_accountId_idx" ON "SignupTracker"("accountId");
CREATE INDEX "SignupTracker_subjectType_subjectId_idx" ON "SignupTracker"("subjectType", "subjectId");
CREATE INDEX "SignupTracker_outcome_nextActionAt_idx" ON "SignupTracker"("outcome", "nextActionAt");
CREATE INDEX "SignupTracker_assignedStaffId_outcome_idx" ON "SignupTracker"("assignedStaffId", "outcome");
CREATE INDEX "SignupTracker_profileKind_stage_idx" ON "SignupTracker"("profileKind", "stage");
ALTER TABLE "SignupTracker" ENABLE ROW LEVEL SECURITY;

-- SignupTrackerEvent
CREATE TABLE "SignupTrackerEvent" (
    "id" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "staffId" TEXT,
    "byStaffId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupTrackerEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SignupTrackerEvent_trackerId_createdAt_idx" ON "SignupTrackerEvent"("trackerId", "createdAt");
ALTER TABLE "SignupTrackerEvent" ADD CONSTRAINT "SignupTrackerEvent_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "SignupTracker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignupTrackerEvent" ENABLE ROW LEVEL SECURITY;

-- CustomerInboxMessage
CREATE TABLE "CustomerInboxMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "profileId" TEXT,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'service',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deepLink" TEXT,
    "data" JSONB,
    "language" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "messageLogId" TEXT,
    "pushStatus" TEXT NOT NULL DEFAULT 'none',
    "scheduledFor" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerInboxMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerInboxMessage_dedupeKey_key" ON "CustomerInboxMessage"("dedupeKey");
CREATE INDEX "CustomerInboxMessage_accountId_createdAt_idx" ON "CustomerInboxMessage"("accountId", "createdAt");
CREATE INDEX "CustomerInboxMessage_accountId_readAt_idx" ON "CustomerInboxMessage"("accountId", "readAt");
CREATE INDEX "CustomerInboxMessage_pushStatus_scheduledFor_idx" ON "CustomerInboxMessage"("pushStatus", "scheduledFor");
ALTER TABLE "CustomerInboxMessage" ADD CONSTRAINT "CustomerInboxMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerInboxMessage" ENABLE ROW LEVEL SECURITY;

-- CustomerNotificationSetting
CREATE TABLE "CustomerNotificationSetting" (
    "accountId" TEXT NOT NULL,
    "service" BOOLEAN NOT NULL DEFAULT true,
    "jobUpdates" BOOLEAN NOT NULL DEFAULT false,
    "promotions" BOOLEAN NOT NULL DEFAULT false,
    "quietStart" TEXT NOT NULL DEFAULT '21:00',
    "quietEnd" TEXT NOT NULL DEFAULT '09:00',
    "dailyCap" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerNotificationSetting_pkey" PRIMARY KEY ("accountId")
);
ALTER TABLE "CustomerNotificationSetting" ADD CONSTRAINT "CustomerNotificationSetting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerNotificationSetting" ENABLE ROW LEVEL SECURITY;

-- CustomerDeletionRequest
CREATE TABLE "CustomerDeletionRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reason" TEXT,
    "guaranteeRunning" BOOLEAN NOT NULL DEFAULT false,
    "refundLossAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "otpVerifiedAt" TIMESTAMP(3) NOT NULL,
    "dataRequestId" TEXT,
    "handledByStaffId" TEXT,
    "handledAt" TIMESTAMP(3),
    "outcomeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDeletionRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerDeletionRequest_status_createdAt_idx" ON "CustomerDeletionRequest"("status", "createdAt");
CREATE INDEX "CustomerDeletionRequest_accountId_idx" ON "CustomerDeletionRequest"("accountId");
ALTER TABLE "CustomerDeletionRequest" ADD CONSTRAINT "CustomerDeletionRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerDeletionRequest" ENABLE ROW LEVEL SECURITY;

-- CustomerCallbackRequest
CREATE TABLE "CustomerCallbackRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "profileId" TEXT,
    "topic" TEXT NOT NULL,
    "note" TEXT,
    "preferredFrom" TEXT,
    "preferredTo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "callTaskId" TEXT,
    "assignedStaffId" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCallbackRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerCallbackRequest_status_createdAt_idx" ON "CustomerCallbackRequest"("status", "createdAt");
CREATE INDEX "CustomerCallbackRequest_accountId_idx" ON "CustomerCallbackRequest"("accountId");
ALTER TABLE "CustomerCallbackRequest" ADD CONSTRAINT "CustomerCallbackRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerCallbackRequest" ENABLE ROW LEVEL SECURITY;

-- CustomerVacancyDraft
CREATE TABLE "CustomerVacancyDraft" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "form" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "vacancyId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerVacancyDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerVacancyDraft_vacancyId_key" ON "CustomerVacancyDraft"("vacancyId");
CREATE INDEX "CustomerVacancyDraft_businessId_status_idx" ON "CustomerVacancyDraft"("businessId", "status");
CREATE INDEX "CustomerVacancyDraft_accountId_status_idx" ON "CustomerVacancyDraft"("accountId", "status");
ALTER TABLE "CustomerVacancyDraft" ADD CONSTRAINT "CustomerVacancyDraft_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerVacancyDraft" ENABLE ROW LEVEL SECURITY;
