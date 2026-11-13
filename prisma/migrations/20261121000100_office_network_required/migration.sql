-- Office network (owner decision 12 Nov): allowed from anywhere for now, switchable
-- later in Settings by the CEO. Off by default; when on, staff who work from the
-- office log in only from an office network range.
ALTER TABLE "PricingPolicy" ADD COLUMN "officeNetworkRequired" BOOLEAN NOT NULL DEFAULT false;
