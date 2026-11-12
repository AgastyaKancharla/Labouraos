-- Go-live (owner decision 12 Nov): the CEO sets the day Laboura starts using the
-- software. Payroll counts only from the later of a person's joining date and this
-- day; days before it are handled outside the app, never absent and never loss of
-- pay. Leave accrual starts from the later of the two. Null = not set.
ALTER TABLE "PricingPolicy" ADD COLUMN "goLiveDate" DATE;
