-- One stored format for every Indian mobile number: "+91" followed by exactly
-- 10 digits starting 6-9 (Master Guide, Forms: "+91 fixed, exactly 10 digits").
-- The API now saves every number this way (src/common/phone/indian-mobile.ts);
-- this rewrites the rows saved before, in place.
--
-- A value is rewritten only when it parses: after removing spaces and dashes it
-- must be 10 digits starting 6-9, optionally preceded by "+91", "91" or "0"
-- (9876543210, +91 98765 43210, 919876543210, 09876543210 -> +919876543210).
-- Anything else is left exactly as it is: landlines, foreign numbers, typos,
-- and the anonymised placeholders ("+91000..." never starts 6-9).
--
-- On the unique columns (JobSeeker.phone, Referral.phone, Business.phone) a row
-- is also left alone when another row already holds, or would also become, the
-- same canonical number, so the migration can never fail on a unique index.
-- The API's duplicate checks still find such a row by its older spelling.
--
-- Idempotent: a second run finds nothing to change.
--
-- Not covered here, because the column does not hold the plain number:
-- Staff.callRoutingPhone and PublicLink.phone (AES-GCM ciphertext; normalised
-- when written and when read), OtpSession (hash + ciphertext of the 10 digits;
-- expires in 5 minutes), BusinessAgreement.signedPhone (stored masked, a signed
-- record) and Vacancy.confirmedPhoneLast4 (last 4 digits only).
--
-- To list the rows left unparsed (run by hand; this migration changes nothing
-- for them), for each column below:
--   SELECT "id", "phone" FROM "JobSeeker"
--   WHERE "phone" IS NOT NULL
--     AND regexp_replace("phone", '[[:space:]-]+', '', 'g') !~ '^(\+91|91|0)?[6-9][0-9]{9}$';
-- and, for the unique columns, the rows skipped because of a clash:
--   SELECT "id", "phone" FROM "JobSeeker"
--   WHERE "phone" !~ '^\+91[6-9][0-9]{9}$'
--     AND regexp_replace("phone", '[[:space:]-]+', '', 'g') ~ '^(\+91|91|0)?[6-9][0-9]{9}$';


-- "JobSeeker"."phone" (unique): a row is rewritten only when no other row already
-- holds, or would also become, the same number.
WITH parsed AS (
  SELECT "id", "phone" AS current, '+91' || (regexp_match(regexp_replace("phone", '[[:space:]-]+', '', 'g'), '^(\+91|91|0)?([6-9][0-9]{9})$'))[2] AS canonical
  FROM "JobSeeker"
),
eligible AS (
  SELECT p."id", p.canonical
  FROM parsed p
  WHERE p.canonical IS NOT NULL
    AND p.current <> p.canonical
    AND NOT EXISTS (
      SELECT 1 FROM parsed o
      WHERE o."id" <> p."id" AND (o.current = p.canonical OR o.canonical = p.canonical)
    )
)
UPDATE "JobSeeker" AS t
SET "phone" = e.canonical
FROM eligible e
WHERE t."id" = e."id";

-- "JobSeeker"."whatsappPhone"
UPDATE "JobSeeker" AS t
SET "whatsappPhone" = p.canonical
FROM (
  SELECT "id", '+91' || (regexp_match(regexp_replace("whatsappPhone", '[[:space:]-]+', '', 'g'), '^(\+91|91|0)?([6-9][0-9]{9})$'))[2] AS canonical
  FROM "JobSeeker"
  WHERE "whatsappPhone" IS NOT NULL
) AS p
WHERE t."id" = p."id"
  AND p.canonical IS NOT NULL
  AND t."whatsappPhone" <> p.canonical;

-- "Referral"."phone" (unique): a row is rewritten only when no other row already
-- holds, or would also become, the same number.
WITH parsed AS (
  SELECT "id", "phone" AS current, '+91' || (regexp_match(regexp_replace("phone", '[[:space:]-]+', '', 'g'), '^(\+91|91|0)?([6-9][0-9]{9})$'))[2] AS canonical
  FROM "Referral"
),
eligible AS (
  SELECT p."id", p.canonical
  FROM parsed p
  WHERE p.canonical IS NOT NULL
    AND p.current <> p.canonical
    AND NOT EXISTS (
      SELECT 1 FROM parsed o
      WHERE o."id" <> p."id" AND (o.current = p.canonical OR o.canonical = p.canonical)
    )
)
UPDATE "Referral" AS t
SET "phone" = e.canonical
FROM eligible e
WHERE t."id" = e."id";

-- "Referral"."whatsappPhone"
UPDATE "Referral" AS t
SET "whatsappPhone" = p.canonical
FROM (
  SELECT "id", '+91' || (regexp_match(regexp_replace("whatsappPhone", '[[:space:]-]+', '', 'g'), '^(\+91|91|0)?([6-9][0-9]{9})$'))[2] AS canonical
  FROM "Referral"
  WHERE "whatsappPhone" IS NOT NULL
) AS p
WHERE t."id" = p."id"
  AND p.canonical IS NOT NULL
  AND t."whatsappPhone" <> p.canonical;

-- "Business"."phone" (unique): a row is rewritten only when no other row already
-- holds, or would also become, the same number.
WITH parsed AS (
  SELECT "id", "phone" AS current, '+91' || (regexp_match(regexp_replace("phone", '[[:space:]-]+', '', 'g'), '^(\+91|91|0)?([6-9][0-9]{9})$'))[2] AS canonical
  FROM "Business"
),
eligible AS (
  SELECT p."id", p.canonical
  FROM parsed p
  WHERE p.canonical IS NOT NULL
    AND p.current <> p.canonical
    AND NOT EXISTS (
      SELECT 1 FROM parsed o
      WHERE o."id" <> p."id" AND (o.current = p.canonical OR o.canonical = p.canonical)
    )
)
UPDATE "Business" AS t
SET "phone" = e.canonical
FROM eligible e
WHERE t."id" = e."id";

-- "Business"."additionalContactPhone"
UPDATE "Business" AS t
SET "additionalContactPhone" = p.canonical
FROM (
  SELECT "id", '+91' || (regexp_match(regexp_replace("additionalContactPhone", '[[:space:]-]+', '', 'g'), '^(\+91|91|0)?([6-9][0-9]{9})$'))[2] AS canonical
  FROM "Business"
  WHERE "additionalContactPhone" IS NOT NULL
) AS p
WHERE t."id" = p."id"
  AND p.canonical IS NOT NULL
  AND t."additionalContactPhone" <> p.canonical;

-- "Business"."contactWhatsAppPhone"
UPDATE "Business" AS t
SET "contactWhatsAppPhone" = p.canonical
FROM (
  SELECT "id", '+91' || (regexp_match(regexp_replace("contactWhatsAppPhone", '[[:space:]-]+', '', 'g'), '^(\+91|91|0)?([6-9][0-9]{9})$'))[2] AS canonical
  FROM "Business"
  WHERE "contactWhatsAppPhone" IS NOT NULL
) AS p
WHERE t."id" = p."id"
  AND p.canonical IS NOT NULL
  AND t."contactWhatsAppPhone" <> p.canonical;

-- "BusinessBranch"."contactPersonPhone"
UPDATE "BusinessBranch" AS t
SET "contactPersonPhone" = p.canonical
FROM (
  SELECT "id", '+91' || (regexp_match(regexp_replace("contactPersonPhone", '[[:space:]-]+', '', 'g'), '^(\+91|91|0)?([6-9][0-9]{9})$'))[2] AS canonical
  FROM "BusinessBranch"
  WHERE "contactPersonPhone" IS NOT NULL
) AS p
WHERE t."id" = p."id"
  AND p.canonical IS NOT NULL
  AND t."contactPersonPhone" <> p.canonical;

-- "BusinessBranch"."contactWhatsAppPhone"
UPDATE "BusinessBranch" AS t
SET "contactWhatsAppPhone" = p.canonical
FROM (
  SELECT "id", '+91' || (regexp_match(regexp_replace("contactWhatsAppPhone", '[[:space:]-]+', '', 'g'), '^(\+91|91|0)?([6-9][0-9]{9})$'))[2] AS canonical
  FROM "BusinessBranch"
  WHERE "contactWhatsAppPhone" IS NOT NULL
) AS p
WHERE t."id" = p."id"
  AND p.canonical IS NOT NULL
  AND t."contactWhatsAppPhone" <> p.canonical;

-- "CallbackTask"."phone"
UPDATE "CallbackTask" AS t
SET "phone" = p.canonical
FROM (
  SELECT "id", '+91' || (regexp_match(regexp_replace("phone", '[[:space:]-]+', '', 'g'), '^(\+91|91|0)?([6-9][0-9]{9})$'))[2] AS canonical
  FROM "CallbackTask"
  WHERE "phone" IS NOT NULL
) AS p
WHERE t."id" = p."id"
  AND p.canonical IS NOT NULL
  AND t."phone" <> p.canonical;
