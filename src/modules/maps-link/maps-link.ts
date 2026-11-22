/**
 * Reading a Google Maps link (17 Nov, item 5) — pure helpers, no network.
 *
 * Only Google's own map addresses are accepted (SSRF-safe: the server never
 * fetches any other host): google.com/maps, www.google.com/maps,
 * maps.google.com, the same three on google.co.in, maps.app.goo.gl and
 * goo.gl/maps. The pin is read from "!3d<lat>!4d<lng>" (the place itself),
 * then a pin in the path (/maps/search/<lat>,+<lng>, /maps/place/<lat>,<lng>),
 * then "@<lat>,<lng>" (the map's centre), then q= / query= / ll= /
 * destination= / center=. The page itself is never read.
 */

export interface MapsPin {
  latitude: number;
  longitude: number;
  /** The place's name when the link carries one (/maps/place/<name>/ or q=<text>). */
  placeName: string | null;
}

/** Hosts whose links are read; a path prefix is required where the host serves more than maps. */
const ALLOWED: Array<{ host: string; pathPrefix: string | null }> = [
  { host: 'google.com', pathPrefix: '/maps' },
  { host: 'www.google.com', pathPrefix: '/maps' },
  { host: 'maps.google.com', pathPrefix: null },
  { host: 'maps.app.goo.gl', pathPrefix: null },
  { host: 'goo.gl', pathPrefix: '/maps' },
  // Google Maps for India (exact hosts only; no other country domains).
  { host: 'google.co.in', pathPrefix: '/maps' },
  { host: 'www.google.co.in', pathPrefix: '/maps' },
  { host: 'maps.google.co.in', pathPrefix: null },
];

/** Short links that must be opened (followed) to find the pin. */
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);

export const MAX_LINK_LENGTH = 2048;

/** Parses the text the agent pasted: the first http(s) address in it (Share often adds the place name before the link). */
export function parseMapsUrl(text: string): URL | null {
  const raw = (text ?? '').trim().slice(0, MAX_LINK_LENGTH * 2);
  const match = raw.match(/https?:\/\/[^\s<>"']+/i);
  const candidate = match ? match[0] : raw;
  if (!candidate || candidate.length > MAX_LINK_LENGTH) return null;
  try {
    const url = new URL(candidate);
    return isAllowedMapsUrl(url) ? url : null;
  } catch {
    return null;
  }
}

/** True only for an http(s) Google Maps address on the allowlist: no user info, default port, exact host. */
export function isAllowedMapsUrl(url: URL): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443' && url.port !== '80') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const rule = ALLOWED.find((r) => r.host === host);
  if (!rule) return false;
  if (rule.pathPrefix && !(url.pathname === rule.pathPrefix || url.pathname.startsWith(`${rule.pathPrefix}/`))) {
    return false;
  }
  return true;
}

export function isShortMapsUrl(url: URL): boolean {
  return SHORT_HOSTS.has(url.hostname.toLowerCase().replace(/\.$/, ''));
}

function validPin(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
const PAIR = new RegExp(`^\\s*${NUM}\\s*,\\s*${NUM}\\s*$`);

function pair(value: string | null): [number, number] | null {
  if (!value) return null;
  const m = value.match(PAIR);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validPin(lat, lng) ? [lat, lng] : null;
}

/** The place's name in a link (/maps/place/<name>, /maps/search/<name>, q= / query=), or null. */
export function placeNameOf(url: URL): string | null {
  const m = url.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/);
  const fromPath = m ? m[1] : null;
  const q = url.searchParams.get('q') ?? url.searchParams.get('query');
  const raw = fromPath ?? (q && !pair(q) ? q : null);
  if (!raw) return null;
  let name: string;
  try {
    name = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    name = raw.replace(/\+/g, ' ');
  }
  name = name.replace(/\s+/g, ' ').trim();
  if (!name || pair(name)) return null;
  return name.slice(0, 120);
}

/** The pin in a Google Maps address, or null when it has none (a short link, or a search by name only). */
export function extractPin(url: URL): MapsPin | null {
  const text = decodeSafe(url.pathname + url.search + url.hash);
  const placeName = placeNameOf(url);
  // !3d<lat>!4d<lng>: the place's own pin (last one wins: it is the selected place).
  const pins = [...text.matchAll(new RegExp(`!3d${NUM}!4d${NUM}`, 'g'))];
  for (const m of pins.reverse()) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (validPin(lat, lng)) return { latitude: lat, longitude: lng, placeName };
  }
  // A dropped pin shared as /maps/search/<lat>,+<lng> or /maps/place/<lat>,<lng>.
  const inPath = decodeSafe(url.pathname).replace(/\+/g, ' ').match(new RegExp(`/maps/(?:search|place|dir)/${NUM}\\s*,\\s*${NUM}(?:/|$)`));
  if (inPath && validPin(Number(inPath[1]), Number(inPath[2]))) {
    return { latitude: Number(inPath[1]), longitude: Number(inPath[2]), placeName: null };
  }
  // @<lat>,<lng>[,<zoom>z]: the map's centre.
  const at = text.match(new RegExp(`@${NUM},${NUM}`));
  if (at && validPin(Number(at[1]), Number(at[2]))) return { latitude: Number(at[1]), longitude: Number(at[2]), placeName };
  for (const key of ['q', 'query', 'll', 'destination', 'center', 'sll']) {
    const p = pair(url.searchParams.get(key));
    if (p) return { latitude: p[0], longitude: p[1], placeName };
  }
  return null;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Is an IP address private, loopback, link-local or otherwise not on the public internet? */
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase();
  if (a.includes(':')) {
    if (a === '::1' || a === '::') return true;
    if (a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80')) return true;
    const mapped = a.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const parts = a.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [p, q] = parts;
  return (
    p === 10 || p === 127 || p === 0 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) ||
    (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224
  );
}

/** Nominatim's answer → the business form's fields. */
export interface ReverseAddress {
  shopNumber: string | null;
  street: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  displayName: string | null;
  /** 22 Nov: the area in words for a GPS fix ("Kothnur, JP Nagar 8th Phase"). */
  locality?: string | null;
}

export function addressFromNominatim(body: unknown): ReverseAddress | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { display_name?: unknown; address?: Record<string, unknown>; error?: unknown };
  if (b.error || !b.address || typeof b.address !== 'object') return null;
  const s = (k: string) => (typeof b.address![k] === 'string' && (b.address![k] as string).trim() ? (b.address![k] as string).trim() : null);
  const postcode = s('postcode')?.replace(/\s/g, '') ?? null;
  const street = [s('road') ?? s('pedestrian') ?? s('street'), s('neighbourhood') ?? s('quarter')].filter(Boolean).join(', ') || null;
  return {
    shopNumber: s('house_number'),
    street,
    area: s('suburb') ?? s('neighbourhood') ?? s('city_district') ?? s('village') ?? null,
    city: s('city') ?? s('town') ?? s('municipality') ?? s('county') ?? s('state_district'),
    state: s('state'),
    pincode: postcode && /^\d{6}$/.test(postcode) ? postcode : null,
    displayName: typeof b.display_name === 'string' ? b.display_name.slice(0, 300) : null,
    locality: localityOf([
      s('neighbourhood') ?? s('quarter') ?? s('hamlet') ?? s('residential'),
      s('suburb') ?? s('city_district') ?? s('village') ?? s('town'),
    ]) ?? localityOf([s('road') ?? s('pedestrian'), s('city') ?? s('town')]),
  };
}

/** "Kothnur, JP Nagar 8th Phase": the area in words for a GPS fix (22 Nov), never the same word twice. */
function localityOf(parts: Array<string | null>): string | null {
  const out: string[] = [];
  for (const p of parts) {
    if (p && !out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  return out.length ? out.join(', ').slice(0, 120) : null;
}

// ------------------------------------------------ tolerant address search (22 Nov)

/** City words never searched on their own (the search is biased to Bengaluru anyway). */
const CITY_WORDS = /^(bengaluru|bangalore|bengaluru urban|bangalore urban|karnataka|india)$/i;
export const SEARCH_CITY = 'Bengaluru';

/**
 * A house or shop number at the start of an address part: "1273", "64/44",
 * "#12-A", "No. 5", "Shop no 3", "Door No: 12/1". Never an ordinal ("45th",
 * "8th"), so "45th Cross" and "8th Phase" stay.
 */
const HOUSE_NUMBER = /^(?:(?:shop|door|house|plot|site|flat)\s*)?(?:no\.?|number|#)?\s*:?\s*\d+[a-z]?(?:\s*[/-]\s*(?:\d+[a-z]?|[a-z]\b))*(?!\s*(?:st|nd|rd|th)\b)(?=\s|,|$)\s*/i;

/** An address part without its house number ("1273 45th Cross" → "45th Cross"); '' when only the number. */
export function withoutHouseNumber(part: string): string {
  let out = part.trim();
  for (let i = 0; i < 2 && HOUSE_NUMBER.test(out); i += 1) out = out.replace(HOUSE_NUMBER, '').trim();
  return /^\d+$/.test(out) ? '' : out;
}

/**
 * The queries tried, in order, for a typed address (owner field test, 22 Nov:
 * "1273 45th Cross, Banashankari" and "64/44 BK Circle, Kottanur, Surabhi
 * Nagar, 8th phase, Kalani Agrahara, Bengaluru" found nothing): the text as
 * typed; then without house numbers or the PIN code, with Bengaluru; then
 * shorter and shorter, dropping the most specific part first, so the locality
 * and city are what is left. At most `max` queries.
 */
export function addressQueries(text: string, max = 5): string[] {
  const cleaned = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/[,\n;]+/)
    .map((p) => withoutHouseNumber(p.replace(/\b\d{6}\b/g, '').replace(/\s+/g, ' ').trim().replace(/^[-–.]+|[-–.]+$/g, '').trim()))
    .filter((p) => p && !CITY_WORDS.test(p));
  const out: string[] = [];
  const add = (q: string) => {
    const v = q.replace(/\s+/g, ' ').trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  add(cleaned);
  for (let start = 0; start < parts.length; start += 1) add([...parts.slice(start), SEARCH_CITY].join(', '));
  return out.slice(0, max);
}

/**
 * Google Maps "Share" text often holds the place's name and address and then
 * the link ("Sri Sai Bakery, 24th Main, JP Nagar https://maps.app.goo.gl/x").
 * The link, and the rest of the text (looked up as an address when the link
 * cannot be read).
 */
export function splitShareText(text: string): { link: string | null; rest: string } {
  const raw = (text ?? '').trim();
  const m = raw.match(/https?:\/\/[^\s<>"']+/i) ?? raw.match(/(?:^|\s)((?:www\.)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:maps\.)?google\.(?:com|co\.in))\/[^\s<>"']*)/i);
  if (!m) return { link: null, rest: raw };
  const link = (m[1] ?? m[0]).trim();
  const rest = raw.replace(link, ' ').replace(/\s+/g, ' ').replace(/^[\s,–-]+|[\s,–-]+$/g, '').trim();
  return { link, rest };
}

/** One place from Google Places (New) Text Search or Place Details → the form's fields and the pin. */
export function placeFromGoogle(body: unknown): { latitude: number; longitude: number; address: ReverseAddress } | null {
  if (!body || typeof body !== 'object') return null;
  const p = body as {
    location?: { latitude?: unknown; longitude?: unknown };
    formattedAddress?: unknown;
    displayName?: { text?: unknown };
    addressComponents?: Array<{ longText?: unknown; types?: unknown }>;
  };
  const latitude = Number(p.location?.latitude);
  const longitude = Number(p.location?.longitude);
  if (!validPin(latitude, longitude) || !insideIndia(latitude, longitude)) return null;
  const comps = Array.isArray(p.addressComponents) ? p.addressComponents : [];
  const of = (...types: string[]): string | null => {
    for (const t of types) {
      const c = comps.find((x) => Array.isArray(x?.types) && (x.types as unknown[]).includes(t) && typeof x.longText === 'string' && x.longText.trim());
      if (c) return (c.longText as string).trim();
    }
    return null;
  };
  const postcode = of('postal_code')?.replace(/\s/g, '') ?? null;
  const neighbourhood = of('sublocality_level_2', 'sublocality_level_3', 'neighborhood');
  const area = of('sublocality_level_1', 'sublocality', 'neighborhood');
  return {
    latitude,
    longitude,
    address: {
      shopNumber: [of('street_number'), of('premise', 'subpremise')].filter(Boolean).join(', ') || null,
      street: [of('route'), neighbourhood !== area ? neighbourhood : null].filter(Boolean).join(', ') || null,
      area,
      city: of('locality', 'administrative_area_level_3', 'administrative_area_level_2'),
      state: of('administrative_area_level_1'),
      pincode: postcode && /^\d{6}$/.test(postcode) ? postcode : null,
      displayName: typeof p.formattedAddress === 'string' ? p.formattedAddress.slice(0, 300) : null,
      locality: localityOf([neighbourhood, area]),
    },
  };
}

/** A Google place id inside a Maps link (q=place_id:… or query_place_id=…), for Place Details. */
export function googlePlaceIdOf(url: URL): string | null {
  const q = url.searchParams.get('q') ?? url.searchParams.get('query') ?? '';
  const fromQ = q.match(/^place_id:([A-Za-z0-9_-]{10,300})$/);
  const id = fromQ?.[1] ?? url.searchParams.get('query_place_id') ?? url.searchParams.get('place_id');
  return id && /^[A-Za-z0-9_-]{10,300}$/.test(id) ? id : null;
}

/**
 * Coordinates typed or pasted on their own ("12.9166, 77.6101", "12.9166 77.6101",
 * "(12.9166,77.6101)"): both numbers need a decimal point, so a house number and a
 * pincode are never read as a pin.
 */
export function parseCoordinates(text: string): { latitude: number; longitude: number } | null {
  const m = (text ?? '').trim().match(/^\(?\s*(-?\d{1,2}\.\d+)\s*°?\s*[NS]?\s*[,\s]\s*(-?\d{1,3}\.\d+)\s*°?\s*[EW]?\s*\)?$/i);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  return validPin(latitude, longitude) ? { latitude, longitude } : null;
}

/** Does the text look like a web address (with or without https://)? */
export function looksLikeLink(text: string): boolean {
  return /https?:\/\//i.test(text) || /(^|\s)(www\.)?(maps\.app\.goo\.gl|goo\.gl\/maps|(maps\.)?google\.(com|co\.in))\//i.test(text);
}

/** A pasted link without its scheme gets https:// so it can be read ("maps.app.goo.gl/abc"). */
export function withScheme(text: string): string {
  if (/https?:\/\//i.test(text)) return text;
  return text.replace(/(^|\s)((?:www\.)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:maps\.)?google\.(?:com|co\.in))\/)/i, '$1https://$2');
}

/** India's box (Nominatim's countrycodes=in already limits the search; this double-checks the answer). */
export function insideIndia(latitude: number, longitude: number): boolean {
  return latitude >= 6 && latitude <= 37.5 && longitude >= 68 && longitude <= 97.5;
}

/** The first usable place in a Nominatim /search answer, with its address. */
export function placeFromNominatimSearch(body: unknown): { latitude: number; longitude: number; address: ReverseAddress | null } | null {
  if (!Array.isArray(body)) return null;
  for (const row of body) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { lat?: unknown; lon?: unknown };
    const latitude = Number(r.lat);
    const longitude = Number(r.lon);
    if (!validPin(latitude, longitude) || !insideIndia(latitude, longitude)) continue;
    return { latitude, longitude, address: addressFromNominatim(row) };
  }
  return null;
}
