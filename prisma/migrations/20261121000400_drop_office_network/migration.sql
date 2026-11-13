-- Owner decision 14 Nov: office networks are removed completely, and the owner
-- approves dropping what held them. Old audit rows keep their network label (not shown).
DROP TABLE "OfficeNetwork";
ALTER TABLE "Staff" DROP COLUMN "worksFromOffice";
ALTER TABLE "LoginCodeRequest" DROP COLUMN "onOfficeNetwork";
