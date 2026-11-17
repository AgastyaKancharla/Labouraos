/**
 * Reading a Google Maps link (17 Nov, item 5) — pure helpers, no network.
 *
 * Only Google's own map addresses are accepted (SSRF-safe: the server never
 * fetches any other host): google.com/maps, www.google.com/maps,
 * maps.google.com, maps.app.goo.gl and goo.gl/maps. The pin is read from
 * "!3d<lat>!4d<lng>" (the place itself), then "@<lat>,<lng>" (the map's
 * centre), then q= / query= / ll= / destination= / center=.
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

function placeNameOf(url: URL): string | null {
  const m = url.pathname.match(/\/maps\/place\/([^/]+)/);
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
  };
}
