-- Owner accounts (owner decision 14 Nov): the CEO marks an owner's own call or
-- field agent account. Its work counts in the lists and reports, but it is left
-- out of targets, leaderboards, attendance, salary and incentives.
ALTER TABLE "Staff" ADD COLUMN "isOwnerAccount" BOOLEAN NOT NULL DEFAULT false;
