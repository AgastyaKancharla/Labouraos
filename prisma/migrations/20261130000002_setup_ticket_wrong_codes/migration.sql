-- First-login set-up: wrong authenticator codes are counted on the set-up
-- ticket itself (5 end it), so a wrong-password lock from the login page
-- never has to stop a set-up already under way (Fable review M-B).
ALTER TABLE "Staff" ADD COLUMN "setupTicketWrongCodes" INTEGER NOT NULL DEFAULT 0;
