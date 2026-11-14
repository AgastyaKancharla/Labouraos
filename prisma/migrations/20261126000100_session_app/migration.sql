-- Each app accepts only its own roles (owner decision 14 Nov): a sign-in, its
-- device request, its login code request and its session record which app
-- they came from ('office' = app.laboura.com, 'field' = Laboura Field). A
-- token works only in its own app. Existing rows stay null (the role's own app).
ALTER TABLE "StaffSession" ADD COLUMN "app" TEXT;
ALTER TABLE "StaffDevice" ADD COLUMN "app" TEXT;
ALTER TABLE "LoginCodeRequest" ADD COLUMN "app" TEXT;
