-- 17 Nov (Master Guide rev 198, "More fixes of 17 Nov", item 2): consent once per item.
-- A consent item already given (and not withdrawn) is never stored again, and giving it
-- again after a withdrawal is a NEW row: the withdrawn row stays as it was (history).
-- So the one-row-per-(subject, purpose, notice version) rule becomes one LIVE row
-- (not withdrawn) per (subject, purpose, notice version). No row is changed or deleted.
DROP INDEX IF EXISTS "Consent_subjectType_subjectId_purpose_noticeVersion_key";
CREATE INDEX "Consent_subjectType_subjectId_purpose_noticeVersion_idx" ON "Consent"("subjectType", "subjectId", "purpose", "noticeVersion");
CREATE UNIQUE INDEX "Consent_live_purpose_key" ON "Consent"("subjectType", "subjectId", "purpose", "noticeVersion") WHERE "withdrawnAt" IS NULL;
