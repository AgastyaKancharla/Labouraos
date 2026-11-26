-- 26 Nov (owner): other licences a business may give (drug licence, KPME, excise, PSARA,
-- contract labour, factory, PESO), all optional.
ALTER TABLE "Business" ADD COLUMN "otherLicences" JSONB;
