/**
 * Legal minimum wage by zone and skill level (Master Guide rev 193, decided
 * 17 Nov; Karnataka minimum wages notification of 22 May 2026). The figures
 * live in PricingPolicy (paise, editable by the CEO on C-Pricing-MinWage);
 * every business has a zone (Business.minimumWageZone) and every trade a
 * skill level (Trade.minimumWageLevel). The check is always
 * `figure[business zone][trade level]`. docs/minimum-wage.md has the
 * sources, the zone rule and the reasoning behind each trade's level.
 */

export type MinimumWageLevel = 'unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled';
export const MINIMUM_WAGE_LEVELS: readonly MinimumWageLevel[] = ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'];

/** 1 = Greater Bengaluru Authority area; 2 = other municipal corporations and district HQs; 3 = rest of Karnataka. */
export type MinimumWageZone = 1 | 2 | 3;
export const MINIMUM_WAGE_ZONES: readonly MinimumWageZone[] = [1, 2, 3];
/** When the address does not tell us, the zone is 1 (the highest figures) until staff set it (guide, 17 Nov). */
export const DEFAULT_MINIMUM_WAGE_ZONE: MinimumWageZone = 1;

export function isMinimumWageZone(value: unknown): value is MinimumWageZone {
  return value === 1 || value === 2 || value === 3;
}

export function isMinimumWageLevel(value: unknown): value is MinimumWageLevel {
  return typeof value === 'string' && (MINIMUM_WAGE_LEVELS as readonly string[]).includes(value);
}

/** The twelve PricingPolicy columns (Zone 1 keeps the four original column names). */
export interface MinimumWagePolicy {
  legalMinimumWageUnskilledPaise: number;
  legalMinimumWageSemiSkilledPaise: number;
  legalMinimumWageSkilledPaise: number;
  legalMinimumWageHighlySkilledPaise: number;
  legalMinimumWageZone2UnskilledPaise: number;
  legalMinimumWageZone2SemiSkilledPaise: number;
  legalMinimumWageZone2SkilledPaise: number;
  legalMinimumWageZone2HighlySkilledPaise: number;
  legalMinimumWageZone3UnskilledPaise: number;
  legalMinimumWageZone3SemiSkilledPaise: number;
  legalMinimumWageZone3SkilledPaise: number;
  legalMinimumWageZone3HighlySkilledPaise: number;
}

export type MinimumWageTable = Record<MinimumWageZone, Record<MinimumWageLevel, number>>;

/** Policy column for one zone and level. */
export const MINIMUM_WAGE_COLUMNS: Record<MinimumWageZone, Record<MinimumWageLevel, keyof MinimumWagePolicy>> = {
  1: {
    unskilled: 'legalMinimumWageUnskilledPaise',
    semi_skilled: 'legalMinimumWageSemiSkilledPaise',
    skilled: 'legalMinimumWageSkilledPaise',
    highly_skilled: 'legalMinimumWageHighlySkilledPaise',
  },
  2: {
    unskilled: 'legalMinimumWageZone2UnskilledPaise',
    semi_skilled: 'legalMinimumWageZone2SemiSkilledPaise',
    skilled: 'legalMinimumWageZone2SkilledPaise',
    highly_skilled: 'legalMinimumWageZone2HighlySkilledPaise',
  },
  3: {
    unskilled: 'legalMinimumWageZone3UnskilledPaise',
    semi_skilled: 'legalMinimumWageZone3SemiSkilledPaise',
    skilled: 'legalMinimumWageZone3SkilledPaise',
    highly_skilled: 'legalMinimumWageZone3HighlySkilledPaise',
  },
};

/** The notification's figures (paise a month), used as the database defaults. */
export const NOTIFICATION_22_MAY_2026: MinimumWageTable = {
  1: { unskilled: 2337643, semi_skilled: 2571407, skilled: 2828547, highly_skilled: 3111402 },
  2: { unskilled: 2125130, semi_skilled: 2337643, skilled: 2571407, highly_skilled: 2828547 },
  3: { unskilled: 1931936, semi_skilled: 2125130, skilled: 2337643, highly_skilled: 2571407 },
};

export function minimumWageTable(policy: MinimumWagePolicy): MinimumWageTable {
  const table = {} as MinimumWageTable;
  for (const zone of MINIMUM_WAGE_ZONES) {
    table[zone] = {} as Record<MinimumWageLevel, number>;
    for (const level of MINIMUM_WAGE_LEVELS) table[zone][level] = policy[MINIMUM_WAGE_COLUMNS[zone][level]];
  }
  return table;
}

/** The legal monthly minimum (paise) for a zone and level; an unknown level is checked as unskilled. */
export function legalMinimumFor(policy: MinimumWagePolicy, zone: number | null | undefined, level: string | null | undefined): number {
  const z = isMinimumWageZone(zone) ? zone : DEFAULT_MINIMUM_WAGE_ZONE;
  const l = isMinimumWageLevel(level) ? level : 'unskilled';
  return policy[MINIMUM_WAGE_COLUMNS[z][l]];
}

/** `{ '1': paise, '2': paise, '3': paise }` for one level — what the apps get per trade. */
export function legalMinimumByZone(policy: MinimumWagePolicy, level: string | null | undefined): Record<'1' | '2' | '3', number> {
  return {
    '1': legalMinimumFor(policy, 1, level),
    '2': legalMinimumFor(policy, 2, level),
    '3': legalMinimumFor(policy, 3, level),
  };
}

// ---------------------------------------------------------------------------
// Zone from an address (docs/minimum-wage.md, "The zone rule").
// ---------------------------------------------------------------------------

/** Names (lower case, spaces collapsed) that mean the Greater Bengaluru Authority area. */
export const ZONE_1_CITY_NAMES: readonly string[] = [
  'bengaluru', 'bangalore', 'bengaluru urban', 'bangalore urban', 'greater bengaluru', 'greater bangalore', 'bengaluru city', 'bangalore city',
];

/**
 * Zone 2: Karnataka's other city corporations and every district headquarters
 * (with the old English spellings people still type). A place that is in
 * doubt (a district whose offices moved) is listed, so it gets Zone 2 rather
 * than the lower Zone 3 figures.
 */
export const ZONE_2_CITY_NAMES: readonly string[] = [
  // City corporations other than Bengaluru.
  'mysuru', 'mysore', 'hubballi', 'hubli', 'dharwad', 'dharwar', 'hubballi-dharwad', 'hubli-dharwad',
  'mangaluru', 'mangalore', 'belagavi', 'belgaum', 'kalaburagi', 'gulbarga', 'davanagere', 'davangere',
  'ballari', 'bellary', 'vijayapura', 'bijapur', 'shivamogga', 'shimoga', 'tumakuru', 'tumkur',
  // District headquarters.
  'bagalkote', 'bagalkot', 'bidar', 'chamarajanagar', 'chamarajanagara', 'chikkaballapur', 'chikkaballapura', 'chikballapur',
  'chikkamagaluru', 'chikmagalur', 'chitradurga', 'gadag', 'gadag-betageri', 'hassan', 'haveri', 'madikeri', 'mercara',
  'kolar', 'koppal', 'mandya', 'raichur', 'ramanagara', 'ramanagaram', 'udupi', 'karwar', 'yadgir', 'yadagiri',
  'hosapete', 'hospet', 'doddaballapura', 'doddaballapur', 'devanahalli',
];

/** Lower case, punctuation other than "-" removed, spaces collapsed. */
export function normalisePlaceName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ZoneSource {
  pincode?: string | null;
  city?: string | null;
  /** Free-text address lines (address, street, locality, landmark): searched for a known city name. */
  addressLines?: Array<string | null | undefined>;
}

export interface ZoneGuess {
  zone: MinimumWageZone;
  /** How it was worked out: a 560 pin code, a known city name, or the Zone 1 default. */
  reason: 'bengaluru_pincode' | 'bengaluru_city' | 'zone2_city' | 'default';
}

function containsPlace(text: string, names: readonly string[]): boolean {
  const padded = ` ${text} `;
  return names.some((name) => padded.includes(` ${name} `));
}

/**
 * The rule (docs/minimum-wage.md):
 *   1. a 6-digit pin code starting 560 (Greater Bengaluru) → Zone 1;
 *   2. a city naming another city corporation or a district HQ → Zone 2;
 *   3. a pin code outside 560… and an address line naming such a city (and
 *      not Bengaluru) → Zone 2;
 *   4. anything else → Zone 1 (the default when unsure); staff set Zone 2 or
 *      3 on the business (C-Business) when it is elsewhere.
 * Zone 3 is never guessed: there is no reliable list of every other town, and
 * guessing it wrongly would apply a lower minimum than the law requires.
 * Address lines only count with a non-Bengaluru pin code, so "Mysore Road,
 * Bengaluru" never becomes Zone 2.
 */
export function zoneForAddress(source: ZoneSource): ZoneGuess {
  const pin = (source.pincode ?? '').replace(/\D/g, '');
  if (/^560\d{3}$/.test(pin)) return { zone: 1, reason: 'bengaluru_pincode' };
  const city = normalisePlaceName(source.city);
  if (city && ZONE_2_CITY_NAMES.includes(city)) return { zone: 2, reason: 'zone2_city' };
  const lines = (source.addressLines ?? []).map(normalisePlaceName).filter(Boolean).join(' ');
  const outsideBengaluruPin = /^\d{6}$/.test(pin);
  if (outsideBengaluruPin && lines && containsPlace(lines, ZONE_2_CITY_NAMES) && !containsPlace(lines, ZONE_1_CITY_NAMES)) {
    return { zone: 2, reason: 'zone2_city' };
  }
  if (ZONE_1_CITY_NAMES.includes(city) || containsPlace(lines, ZONE_1_CITY_NAMES)) return { zone: 1, reason: 'bengaluru_city' };
  return { zone: DEFAULT_MINIMUM_WAGE_ZONE, reason: 'default' };
}

/** Zone of a business row (or a form about to become one). */
export function zoneForBusiness(b: {
  pincode?: string | null;
  city?: string | null;
  address?: string | null;
  street?: string | null;
  locality?: string | null;
  landmark?: string | null;
}): ZoneGuess {
  return zoneForAddress({ pincode: b.pincode, city: b.city, addressLines: [b.address, b.street, b.locality, b.landmark] });
}

/** The fields of a business whose change can move its zone (when the zone was not set by staff). */
export const ZONE_ADDRESS_FIELDS: readonly string[] = ['pincode', 'address', 'street', 'locality', 'landmark', 'city'];
