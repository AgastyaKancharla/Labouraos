-- English only, everywhere (Master Guide rev 193, decided 17 Nov 2026). No column is
-- removed: old rows and older app versions keep working, but nothing offers or sends
-- another language any more (src/common/language/english-only.ts).
--
-- 1. Per-person message / app language preferences become English, so no message,
--    link or page can pick Kannada or Hindi from an old row.
UPDATE "JobSeeker" SET "messageLanguage" = 'en' WHERE "messageLanguage" IS NOT NULL AND "messageLanguage" <> 'en';
UPDATE "Business" SET "contactLanguage" = 'en' WHERE "contactLanguage" IS NOT NULL AND "contactLanguage" <> 'en';
UPDATE "BusinessBranch" SET "contactLanguage" = 'en' WHERE "contactLanguage" IS NOT NULL AND "contactLanguage" <> 'en';
UPDATE "Referral" SET "language" = 'en' WHERE "language" IS NOT NULL AND "language" <> 'en';
UPDATE "CustomerAccount" SET "language" = 'en' WHERE "language" <> 'en';

-- 2. Open app sign-ups no longer carry the app language (it is always English), so
--    sign-up help goes by fair share rather than by a language nobody chose.
UPDATE "SignupTracker" SET "language" = NULL WHERE "outcome" = 'open' AND "language" IS NOT NULL;

-- 3. Links already sent in Kannada or Hindi and not used yet (agreement, partner terms,
--    job seeker registration, vacancy confirmation…) froze their text in that language.
--    They are withdrawn; the agent sends a new one, which is in English. Used links and
--    every record of what someone accepted (Consent, LegalAcceptance, LegalDocumentText,
--    JobSeeker.termsAcceptedLanguage) are history and are left exactly as they are.
UPDATE "PublicLink"
SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "usedAt" IS NULL
  AND "revokedAt" IS NULL
  AND "expiresAt" > CURRENT_TIMESTAMP
  AND (
    "language" IN ('kn', 'hi')
    OR "metadata"->'agreement'->>'language' IN ('kn', 'hi')
    OR "metadata"->'terms'->>'language' IN ('kn', 'hi')
  );
