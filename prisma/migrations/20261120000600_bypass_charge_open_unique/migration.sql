-- B4 (12 Nov): at most one open (raised) no-bypass charge per business and person.
-- A partial unique index, so a cancelled charge does not block raising a new one.
CREATE UNIQUE INDEX "BypassCharge_open_business_jobSeeker_key"
  ON "BypassCharge"("businessId", "jobSeekerId")
  WHERE "status" = 'raised';
