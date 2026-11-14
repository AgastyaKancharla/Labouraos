-- Settings for the customer app sign-up tracker (proposal 4.2): when reminders,
-- call tasks and visit requests happen. CEO-editable versions of PricingPolicy;
-- null means the default. Read by the back-office sign-up tracker.
ALTER TABLE "PricingPolicy" ADD COLUMN "signupFirstReminderMinutes" INTEGER DEFAULT 30;
ALTER TABLE "PricingPolicy" ADD COLUMN "signupSecondReminderMinutes" INTEGER DEFAULT 240;
ALTER TABLE "PricingPolicy" ADD COLUMN "signupBusinessCallMinutes" INTEGER DEFAULT 240;
ALTER TABLE "PricingPolicy" ADD COLUMN "signupPaymentStopWorkingMinutes" INTEGER DEFAULT 120;
ALTER TABLE "PricingPolicy" ADD COLUMN "signupMaxCallTries" INTEGER DEFAULT 3;
ALTER TABLE "PricingPolicy" ADD COLUMN "signupCallTryDays" INTEGER DEFAULT 3;
ALTER TABLE "PricingPolicy" ADD COLUMN "signupReengageDays" INTEGER DEFAULT 30;
ALTER TABLE "PricingPolicy" ADD COLUMN "signupAreaClusterMin" INTEGER DEFAULT 3;
ALTER TABLE "PricingPolicy" ADD COLUMN "signupStuckHours" INTEGER DEFAULT 24;
ALTER TABLE "PricingPolicy" ADD CONSTRAINT "PricingPolicy_signupFirstReminderMinutes_check" CHECK ("signupFirstReminderMinutes" IS NULL OR ("signupFirstReminderMinutes" BETWEEN 1 AND 10080));
ALTER TABLE "PricingPolicy" ADD CONSTRAINT "PricingPolicy_signupSecondReminderMinutes_check" CHECK ("signupSecondReminderMinutes" IS NULL OR ("signupSecondReminderMinutes" BETWEEN 1 AND 20160));
ALTER TABLE "PricingPolicy" ADD CONSTRAINT "PricingPolicy_signupBusinessCallMinutes_check" CHECK ("signupBusinessCallMinutes" IS NULL OR ("signupBusinessCallMinutes" BETWEEN 1 AND 10080));
ALTER TABLE "PricingPolicy" ADD CONSTRAINT "PricingPolicy_signupPaymentStopWorkingMinutes_check" CHECK ("signupPaymentStopWorkingMinutes" IS NULL OR ("signupPaymentStopWorkingMinutes" BETWEEN 1 AND 10080));
ALTER TABLE "PricingPolicy" ADD CONSTRAINT "PricingPolicy_signupMaxCallTries_check" CHECK ("signupMaxCallTries" IS NULL OR ("signupMaxCallTries" BETWEEN 1 AND 10));
ALTER TABLE "PricingPolicy" ADD CONSTRAINT "PricingPolicy_signupCallTryDays_check" CHECK ("signupCallTryDays" IS NULL OR ("signupCallTryDays" BETWEEN 1 AND 30));
ALTER TABLE "PricingPolicy" ADD CONSTRAINT "PricingPolicy_signupReengageDays_check" CHECK ("signupReengageDays" IS NULL OR ("signupReengageDays" BETWEEN 1 AND 365));
ALTER TABLE "PricingPolicy" ADD CONSTRAINT "PricingPolicy_signupAreaClusterMin_check" CHECK ("signupAreaClusterMin" IS NULL OR ("signupAreaClusterMin" BETWEEN 2 AND 100));
ALTER TABLE "PricingPolicy" ADD CONSTRAINT "PricingPolicy_signupStuckHours_check" CHECK ("signupStuckHours" IS NULL OR ("signupStuckHours" BETWEEN 1 AND 720));
