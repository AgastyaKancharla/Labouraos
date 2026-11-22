-- Laboura Field shop visit simplified (Master Guide rev 207–208, owner's field test, 22 Nov).
-- Additive only: no new table (so no new RLS policy), nothing renamed or dropped.

-- "Close this revisit": the agent stops further revisits of a shop with a reason. The visit is
-- kept (never deleted); the Team Lead sees closed revisits in Visit proof; every close is audited.
ALTER TABLE "BusinessVisit" ADD COLUMN "revisitClosedAt" TIMESTAMP(3);
ALTER TABLE "BusinessVisit" ADD COLUMN "revisitClosedReason" TEXT;
ALTER TABLE "BusinessVisit" ADD COLUMN "revisitClosedNote" TEXT;
ALTER TABLE "BusinessVisit" ADD COLUMN "revisitClosedByStaffId" TEXT;

-- Business type "Other (type it)": the type in the owner's words (required when Other is chosen).
ALTER TABLE "Business" ADD COLUMN "businessTypeOther" TEXT;
