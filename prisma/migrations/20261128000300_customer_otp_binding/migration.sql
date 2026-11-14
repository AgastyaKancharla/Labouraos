-- Customer OTP codes are bound to the flow, installation and account that asked
-- for them; deletion requests record how the person proved it was them, whether
-- a refund was still owed, and a cancellation.
ALTER TABLE "CustomerOtpAttempt" ADD COLUMN "requestId" TEXT;
ALTER TABLE "CustomerOtpAttempt" ADD COLUMN "purpose" TEXT;
ALTER TABLE "CustomerOtpAttempt" ADD COLUMN "accountId" TEXT;
CREATE INDEX "CustomerOtpAttempt_requestId_idx" ON "CustomerOtpAttempt"("requestId");

ALTER TABLE "CustomerDeletionRequest" ADD COLUMN "proof" TEXT NOT NULL DEFAULT 'otp';
ALTER TABLE "CustomerDeletionRequest" ADD COLUMN "refundOwedAtRequest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerDeletionRequest" ADD COLUMN "cancelledAt" TIMESTAMP(3);
