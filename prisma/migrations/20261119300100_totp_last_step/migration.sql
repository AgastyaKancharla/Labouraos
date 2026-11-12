-- The 30-second step of the last authenticator code accepted for a person, so the
-- same code can't be used twice inside its window (security check L9).
ALTER TABLE "Staff" ADD COLUMN "totpLastStep" INTEGER;
