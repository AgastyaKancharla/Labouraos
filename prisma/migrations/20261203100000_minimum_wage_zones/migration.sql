-- Legal minimum wage by zone and skill level (Master Guide rev 193, decided 17 Nov 2026;
-- Karnataka minimum wages notification of 22 May 2026). docs/minimum-wage.md has the
-- figures, the sources, the zone rule and each trade's level.

-- 1. Every business gets a zone: 1 Greater Bengaluru, 2 other municipal corporations
--    and district headquarters, 3 rest of Karnataka. "auto" follows the address;
--    "staff" was set by office staff and is kept.
ALTER TABLE "Business"
  ADD COLUMN "minimumWageZone" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "minimumWageZoneSource" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "Business"
  ADD CONSTRAINT "Business_minimumWageZone_check" CHECK ("minimumWageZone" IN (1, 2, 3)),
  ADD CONSTRAINT "Business_minimumWageZoneSource_check" CHECK ("minimumWageZoneSource" IN ('auto', 'staff'));

-- Backfill with the same rule as zoneForAddress (src/modules/trade/minimum-wage.ts):
-- a 560xxx pin code is Zone 1; a city that is another corporation or a district HQ
-- is Zone 2; a non-560 pin code with such a city in the address (and not Bengaluru)
-- is Zone 2; everything else stays Zone 1 (the default when unsure).
UPDATE "Business"
SET "minimumWageZone" = 2
WHERE NOT (regexp_replace(coalesce("pincode", ''), '\D', '', 'g') ~ '^560[0-9]{3}$')
  AND (
    lower(regexp_replace(btrim(coalesce("city", '')), '\s+', ' ', 'g')) IN (
    'mysuru',
    'mysore',
    'hubballi',
    'hubli',
    'dharwad',
    'dharwar',
    'hubballi-dharwad',
    'hubli-dharwad',
    'mangaluru',
    'mangalore',
    'belagavi',
    'belgaum',
    'kalaburagi',
    'gulbarga',
    'davanagere',
    'davangere',
    'ballari',
    'bellary',
    'vijayapura',
    'bijapur',
    'shivamogga',
    'shimoga',
    'tumakuru',
    'tumkur',
    'bagalkote',
    'bagalkot',
    'bidar',
    'chamarajanagar',
    'chamarajanagara',
    'chikkaballapur',
    'chikkaballapura',
    'chikballapur',
    'chikkamagaluru',
    'chikmagalur',
    'chitradurga',
    'gadag',
    'gadag-betageri',
    'hassan',
    'haveri',
    'madikeri',
    'mercara',
    'kolar',
    'koppal',
    'mandya',
    'raichur',
    'ramanagara',
    'ramanagaram',
    'udupi',
    'karwar',
    'yadgir',
    'yadagiri',
    'hosapete',
    'hospet',
    'doddaballapura',
    'doddaballapur',
    'devanahalli'
    )
    OR (
      regexp_replace(coalesce("pincode", ''), '\D', '', 'g') ~ '^[0-9]{6}$'
      AND concat_ws(' ', "address", "street", "locality", "landmark") ~* '\m(mysuru|mysore|hubballi|hubli|dharwad|dharwar|hubballi\-dharwad|hubli\-dharwad|mangaluru|mangalore|belagavi|belgaum|kalaburagi|gulbarga|davanagere|davangere|ballari|bellary|vijayapura|bijapur|shivamogga|shimoga|tumakuru|tumkur|bagalkote|bagalkot|bidar|chamarajanagar|chamarajanagara|chikkaballapur|chikkaballapura|chikballapur|chikkamagaluru|chikmagalur|chitradurga|gadag|gadag\-betageri|hassan|haveri|madikeri|mercara|kolar|koppal|mandya|raichur|ramanagara|ramanagaram|udupi|karwar|yadgir|yadagiri|hosapete|hospet|doddaballapura|doddaballapur|devanahalli)\M'
      AND NOT (concat_ws(' ', "address", "street", "locality", "landmark") ~* '\m(bengaluru|bangalore|bengaluru urban|bangalore urban|greater bengaluru|greater bangalore|bengaluru city|bangalore city)\M')
    )
  );

-- 2. All twelve figures in the policy settings (paise a month). The four existing
--    columns keep their meaning (Zone 1) and get the exact paise of the notification
--    (they were rounded to the rupee); a figure the CEO already changed is kept.
ALTER TABLE "PricingPolicy"
  ALTER COLUMN "legalMinimumWageUnskilledPaise" SET DEFAULT 2337643,
  ALTER COLUMN "legalMinimumWageSemiSkilledPaise" SET DEFAULT 2571407,
  ALTER COLUMN "legalMinimumWageSkilledPaise" SET DEFAULT 2828547,
  ALTER COLUMN "legalMinimumWageHighlySkilledPaise" SET DEFAULT 3111402,
  ADD COLUMN "legalMinimumWageZone2UnskilledPaise" INTEGER NOT NULL DEFAULT 2125130,
  ADD COLUMN "legalMinimumWageZone2SemiSkilledPaise" INTEGER NOT NULL DEFAULT 2337643,
  ADD COLUMN "legalMinimumWageZone2SkilledPaise" INTEGER NOT NULL DEFAULT 2571407,
  ADD COLUMN "legalMinimumWageZone2HighlySkilledPaise" INTEGER NOT NULL DEFAULT 2828547,
  ADD COLUMN "legalMinimumWageZone3UnskilledPaise" INTEGER NOT NULL DEFAULT 1931936,
  ADD COLUMN "legalMinimumWageZone3SemiSkilledPaise" INTEGER NOT NULL DEFAULT 2125130,
  ADD COLUMN "legalMinimumWageZone3SkilledPaise" INTEGER NOT NULL DEFAULT 2337643,
  ADD COLUMN "legalMinimumWageZone3HighlySkilledPaise" INTEGER NOT NULL DEFAULT 2571407;
ALTER TABLE "PricingPolicy"
  ADD CONSTRAINT "PricingPolicy_legalMinimumWage_positive_check" CHECK (
    "legalMinimumWageUnskilledPaise" > 0 AND "legalMinimumWageSemiSkilledPaise" > 0
    AND "legalMinimumWageSkilledPaise" > 0 AND "legalMinimumWageHighlySkilledPaise" > 0
    AND "legalMinimumWageZone2UnskilledPaise" > 0 AND "legalMinimumWageZone2SemiSkilledPaise" > 0
    AND "legalMinimumWageZone2SkilledPaise" > 0 AND "legalMinimumWageZone2HighlySkilledPaise" > 0
    AND "legalMinimumWageZone3UnskilledPaise" > 0 AND "legalMinimumWageZone3SemiSkilledPaise" > 0
    AND "legalMinimumWageZone3SkilledPaise" > 0 AND "legalMinimumWageZone3HighlySkilledPaise" > 0
  );
UPDATE "PricingPolicy" SET "legalMinimumWageUnskilledPaise" = 2337643 WHERE "legalMinimumWageUnskilledPaise" = 2337600;
UPDATE "PricingPolicy" SET "legalMinimumWageSemiSkilledPaise" = 2571407 WHERE "legalMinimumWageSemiSkilledPaise" = 2571400;
UPDATE "PricingPolicy" SET "legalMinimumWageSkilledPaise" = 2828547 WHERE "legalMinimumWageSkilledPaise" = 2828600;
UPDATE "PricingPolicy" SET "legalMinimumWageHighlySkilledPaise" = 3111402 WHERE "legalMinimumWageHighlySkilledPaise" = 3111400;

-- 3. Each trade's skill level, reviewed against the notification's categories
--    (docs/minimum-wage.md, "Trade levels"). Every trade was still at the column's
--    default (unskilled): that put cooks, drivers and electricians on the unskilled
--    figure. Only rows still at that default are changed, so a level the CEO set is kept.
UPDATE "Trade" SET "minimumWageLevel" = 'skilled'
WHERE "minimumWageLevel" = 'unskilled'
  AND "nameKey" IN ('cook', 'driver', 'electrician', 'plumber', 'carpenter', 'painter', 'ac technician');
UPDATE "Trade" SET "minimumWageLevel" = 'semi_skilled'
WHERE "minimumWageLevel" = 'unskilled'
  AND "nameKey" IN ('waiter', 'delivery rider', 'security guard', 'warehouse packer', 'retail staff', 'caretaker / nanny');
