-- "How they heard about Laboura" gains "laboura_app" (customer app proposal C3):
-- people who signed up themselves in the Laboura app.
ALTER TABLE "JobSeeker" DROP CONSTRAINT "JobSeeker_heardFrom_check";
ALTER TABLE "JobSeeker" ADD CONSTRAINT "JobSeeker_heardFrom_check"
  CHECK ("heardFrom" IS NULL OR "heardFrom" IN ('toll_free_missed_call', 'ad', 'referral_partner', 'field_visit', 'social_media', 'walk_in', 'other', 'laboura_app'));
