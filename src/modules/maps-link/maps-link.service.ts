import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { lookup as dnsLookup } from 'dns/promises';
import { codedError } from '../../common/http/coded-error';
import {
  addressFromNominatim,
  extractPin,
  isAllowedMapsUrl,
  isPrivateAddress,
  isShortMapsUrl,
  looksLikeLink,
  MapsPin,
  parseCoordinates,
  parseMapsUrl,
  placeFromNominatimSearch,
  placeNameOf,
  ReverseAddress,
  withScheme,
} from './maps-link';

/** The fetch the service uses (tests replace it; nothing else may be fetched). */
export const MAPS_HTTP = Symbol('MAPS_HTTP');
export type MapsFetch = (url: string, init: { method: 'GET'; redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  body?: { cancel?: () => Promise<void> } | null;
}>;
/** Host name → addresses (tests replace it). */
export const MAPS_DNS = Symbol('MAPS_DNS');
export type MapsDns = (host: string) => Promise<string[]>;

/** The real network: Node's fetch, and the system resolver. */
export const defaultMapsFetch: MapsFetch = (url, init) => fetch(url, init) as unknown as ReturnType<MapsFetch>;
export const defaultMapsDns: MapsDns = async (host) => (await dnsLookup(host, { all: true })).map((r) => r.address);

/** Rule for every outside call: at most 5 redirects, 5 seconds in all. */
export const MAX_REDIRECTS = 5;
export const TIMEOUT_MS = 5000;
/** Nominatim usage policy: at most one request a second (we keep a little more), with a User-Agent naming the app. */
export const NOMINATIM_GAP_MS = 1100;
export const USER_AGENT = 'Laboura/1.0 (Laboura Field staffing app; business address from a map pin)';
/** Per field agent: links read a minute and a day (in memory, per process). */
export const LINKS_PER_MINUTE = 10;
export const LINKS_PER_DAY = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Addresses and opened links are kept this many days (Nominatim asks callers to cache). */
const CACHE_DAYS = 30;
const CACHE_TTL_MS = CACHE_DAYS * DAY_MS;
const CACHE_MAX = 5000;

/** A link that opens a search or a place page without coordinates: the page is never read, so ask for a pin. */
export const NO_PIN_MESSAGE = 'This link has no map pin. In Google Maps, long-press to drop a pin, then share that.';
/** A link whose place name OpenStreetMap could not find. */
export const NAME_NOT_FOUND_MESSAGE = 'Couldn’t find the place in this link on the map. In Google Maps, long-press to drop a pin and share that, or type the address.';
/** A typed address OpenStreetMap could not find. */
export const ADDRESS_NOT_FOUND_MESSAGE = 'Couldn’t find that address. Add the area and city (e.g. "24th Main, JP Nagar, Bengaluru"), paste a Google Maps link, or type the coordinates.';
/** OpenStreetMap could not be reached for a search. */
export const LOOKUP_UNAVAILABLE_MESSAGE = 'The map lookup is not answering right now. Try again in a minute, or paste a Google Maps link with a pin, or type the coordinates.';
/** The longest typed address looked up. */
export const MAX_ADDRESS_LENGTH = 300;
/**
 * Bengaluru's box for address searches (left, top, right, bottom): the search
 * looks inside it first, then anywhere in India (countrycodes=in).
 */
export const BENGALURU_VIEWBOX = '77.30,13.25,77.95,12.70';

export type LocateSource = 'coordinates' | 'link' | 'address';

/** "Set the map pin" (21 Nov, rev 204): where the text points, for the agent to confirm on the map. */
export interface LocatedPin {
  latitude: number;
  longitude: number;
  /** What the agent gave: typed coordinates, a Google Maps link, or a typed address. */
  source: LocateSource;
  placeName: string | null;
  /** The address line it matched (OpenStreetMap), shown under "Is this the right place?". */
  matched: string | null;
  address: ReverseAddress | null;
  shortLink: boolean;
}

export interface ResolvedMapsLink {
  latitude: number;
  longitude: number;
  placeName: string | null;
  /** Null when OpenStreetMap had no address for the pin (the agent types it). */
  address: ReverseAddress | null;
  /** The link had to be opened (a short maps.app.goo.gl / goo.gl/maps link). */
  shortLink: boolean;
}

/**
 * "Paste Google Maps link" on the Field business form (17 Nov, item 5): the
 * pin from the link (a short link is followed, Google map hosts only, at most
 * 5 redirects, 5 s), and the address for it from OpenStreetMap's free
 * Nominatim reverse lookup (no paid Google API): one request a second at
 * most, results cached, a User-Agent naming Laboura. Rate-limited per agent.
 */
@Injectable()
export class MapsLinkService {
  private readonly logger = new Logger(MapsLinkService.name);
  private readonly addressCache = new Map<string, { at: number; value: ReverseAddress | null }>();
  private readonly linkCache = new Map<string, { at: number; value: MapsPin }>();
  private readonly searchCache = new Map<string, { at: number; value: { latitude: number; longitude: number; address: ReverseAddress | null } | null }>();
  private readonly perAgent = new Map<string, number[]>();
  private nominatimQueue: Promise<unknown> = Promise.resolve();
  private lastNominatimAt = 0;

  constructor(
    @Optional() @Inject(MAPS_HTTP) private readonly http?: MapsFetch,
    @Optional() @Inject(MAPS_DNS) private readonly dns?: MapsDns,
  ) {}

  /** The clock (tests move it). */
  protected now(): number {
    return Date.now();
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private fetcher(): MapsFetch {
    return this.http ?? defaultMapsFetch;
  }

  private addresses(host: string): Promise<string[]> {
    return (this.dns ?? defaultMapsDns)(host);
  }

  private nominatimBase(): string {
    return (process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
  }

  async resolve(staffId: string, text: unknown): Promise<ResolvedMapsLink> {
    this.claim(staffId);
    return this.fromLink(typeof text === 'string' ? withScheme(text) : '');
  }

  /**
   * "Set the map pin" everywhere a pin is set (21 Nov, rev 204): coordinates,
   * any Google Maps link (full or short; a link with only a place name is
   * looked up by that name), or a typed address looked up with OpenStreetMap
   * (Bengaluru first, then India). The agent confirms the result on the map.
   */
  async locate(staffId: string, text: unknown): Promise<LocatedPin> {
    this.claim(staffId);
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) throw codedError(HttpStatus.BAD_REQUEST, 'MAPS_TEXT_EMPTY', 'Type an address, paste a Google Maps link or type the coordinates');
    const coordinates = parseCoordinates(raw);
    if (coordinates) {
      const address = await this.reverse(coordinates.latitude, coordinates.longitude);
      return { ...coordinates, source: 'coordinates', placeName: null, matched: address?.displayName ?? null, address, shortLink: false };
    }
    if (looksLikeLink(raw)) {
      const found = await this.fromLink(withScheme(raw));
      return { ...found, source: 'link', matched: found.address?.displayName ?? found.placeName };
    }
    if (raw.length > MAX_ADDRESS_LENGTH) throw codedError(HttpStatus.BAD_REQUEST, 'MAPS_ADDRESS_TOO_LONG', `Keep the address under ${MAX_ADDRESS_LENGTH} characters`);
    const { place, reached } = await this.searchPlace(raw);
    if (!place && !reached) throw codedError(HttpStatus.BAD_GATEWAY, 'MAPS_LOOKUP_UNAVAILABLE', LOOKUP_UNAVAILABLE_MESSAGE);
    if (!place) throw codedError(HttpStatus.UNPROCESSABLE_ENTITY, 'MAPS_ADDRESS_NOT_FOUND', ADDRESS_NOT_FOUND_MESSAGE);
    return {
      latitude: place.latitude,
      longitude: place.longitude,
      source: 'address',
      placeName: null,
      matched: place.address?.displayName ?? null,
      address: place.address,
      shortLink: false,
    };
  }

  /** The pin a Google Maps link points at, and its address. */
  private async fromLink(text: string): Promise<ResolvedMapsLink> {
    const url = parseMapsUrl(text);
    if (!url) throw codedError(HttpStatus.BAD_REQUEST, 'MAPS_LINK_INVALID', 'Paste a Google Maps link (google.com/maps, google.co.in/maps, maps.google.com, maps.app.goo.gl or goo.gl/maps)');
    const shortLink = isShortMapsUrl(url);
    let pin = extractPin(url);
    let name = placeNameOf(url);
    // A short link (or a full one with neither pin nor name) is opened, hop by hop, to read where it leads.
    if (!pin && (shortLink || !name)) {
      const followed = await this.follow(url);
      pin = followed.pin;
      name = followed.last ? placeNameOf(followed.last) ?? name : name;
    }
    if (!pin && name) {
      // The final link has only a place name: look that name up (OpenStreetMap, Bengaluru first).
      const { place, reached } = await this.searchPlace(name);
      if (!place && !reached) throw codedError(HttpStatus.BAD_GATEWAY, 'MAPS_LOOKUP_UNAVAILABLE', LOOKUP_UNAVAILABLE_MESSAGE);
      if (!place) throw codedError(HttpStatus.UNPROCESSABLE_ENTITY, 'MAPS_LINK_NO_LOCATION', NAME_NOT_FOUND_MESSAGE);
      return { latitude: place.latitude, longitude: place.longitude, placeName: name, address: place.address, shortLink };
    }
    if (!pin) throw codedError(HttpStatus.UNPROCESSABLE_ENTITY, 'MAPS_LINK_NO_LOCATION', NO_PIN_MESSAGE);
    const address = await this.reverse(pin.latitude, pin.longitude);
    return { latitude: pin.latitude, longitude: pin.longitude, placeName: pin.placeName, address, shortLink };
  }

  /** At most LINKS_PER_MINUTE a minute and LINKS_PER_DAY a day per agent. */
  private claim(staffId: string): void {
    const now = this.now();
    const recent = (this.perAgent.get(staffId) ?? []).filter((t) => now - t < DAY_MS);
    const lastMinute = recent.filter((t) => now - t < 60 * 1000).length;
    if (lastMinute >= LINKS_PER_MINUTE || recent.length >= LINKS_PER_DAY) {
      this.perAgent.set(staffId, recent);
      throw codedError(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY', 'Too many links in a short time. Wait a minute and try again.', {
        retryAfterSeconds: recent.length >= LINKS_PER_DAY ? DAY_MS / 1000 : 60,
      });
    }
    recent.push(now);
    this.perAgent.set(staffId, recent);
    if (this.perAgent.size > 10_000) {
      for (const [id, times] of this.perAgent) if (!times.some((t) => now - t < DAY_MS)) this.perAgent.delete(id);
    }
  }

  /**
   * Opens a link that has no pin in it (a short link), following redirects by
   * hand so each hop is checked: Google map hosts only, https, a public
   * address, at most MAX_REDIRECTS, TIMEOUT_MS for the whole chain. The body
   * is never read.
   */
  private async follow(start: URL): Promise<{ pin: MapsPin | null; last: URL | null }> {
    const key = start.toString();
    const cached = this.linkCache.get(key);
    if (cached && this.now() - cached.at < CACHE_TTL_MS) return { pin: cached.value, last: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let current = new URL(start.toString());
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        if (!isAllowedMapsUrl(current)) throw codedError(HttpStatus.UNPROCESSABLE_ENTITY, 'MAPS_LINK_NO_LOCATION', 'The link leads outside Google Maps');
        current.protocol = 'https:';
        current.port = '';
        const found = extractPin(current);
        if (found) {
          this.remember(this.linkCache, key, found);
          return { pin: found, last: current };
        }
        if (hop === MAX_REDIRECTS) break;
        const ips = await this.addresses(current.hostname);
        if (ips.length === 0 || ips.some(isPrivateAddress)) throw codedError(HttpStatus.BAD_GATEWAY, 'MAPS_LINK_UNREACHABLE', 'The link could not be opened');
        const res = await this.fetcher()(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        });
        await res.body?.cancel?.().catch(() => undefined);
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (!location) return { pin: null, last: current };
        current = new URL(location, current);
      }
      throw codedError(HttpStatus.UNPROCESSABLE_ENTITY, 'MAPS_LINK_NO_LOCATION', NO_PIN_MESSAGE);
    } catch (error) {
      if (error && typeof (error as { getStatus?: unknown }).getStatus === 'function') throw error;
      this.logger.warn(`Maps link not opened: ${(error as Error)?.name ?? 'error'}`);
      throw codedError(HttpStatus.BAD_GATEWAY, 'MAPS_LINK_UNREACHABLE', 'The link could not be opened');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * OpenStreetMap Nominatim search for a typed address or a place name: inside
   * Bengaluru's box first, then anywhere in India; cached; one request a
   * second (shared with the reverse lookups); null when nothing is found or
   * Nominatim cannot be reached.
   */
  async search(text: string): Promise<{ latitude: number; longitude: number; address: ReverseAddress | null } | null> {
    return (await this.searchPlace(text)).place;
  }

  /** The search, and whether Nominatim answered at all (so "not found" and "could not look it up" differ). */
  private async searchPlace(text: string): Promise<{ place: { latitude: number; longitude: number; address: ReverseAddress | null } | null; reached: boolean }> {
    const q = text.replace(/\s+/g, ' ').trim().slice(0, MAX_ADDRESS_LENGTH);
    if (!q) return { place: null, reached: true };
    const key = q.toLowerCase();
    const cached = this.searchCache.get(key);
    if (cached && this.now() - cached.at < CACHE_TTL_MS) return { place: cached.value, reached: true };
    const base = `${this.nominatimBase()}/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=in&addressdetails=1&limit=1&accept-language=en`;
    let reached = false;
    let found: { latitude: number; longitude: number; address: ReverseAddress | null } | null = null;
    for (const url of [`${base}&viewbox=${BENGALURU_VIEWBOX}&bounded=1`, base]) {
      const body = await this.nominatim(url);
      if (body === undefined) continue;
      reached = true;
      found = placeFromNominatimSearch(body);
      if (found) break;
    }
    // A miss is remembered too (not a failure to reach Nominatim, which is tried again next time).
    if (reached) this.remember(this.searchCache, key, found);
    return { place: found, reached };
  }

  /** One Nominatim request, one at a time with the gap; the parsed JSON, or undefined when it failed. */
  private nominatim(url: string): Promise<unknown> {
    const run = async (): Promise<unknown> => {
      const wait = this.lastNominatimAt + NOMINATIM_GAP_MS - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastNominatimAt = this.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await this.fetcher()(url, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (res.status !== 200) {
          await res.body?.cancel?.().catch(() => undefined);
          this.logger.warn(`Nominatim answered ${res.status}`);
          return undefined;
        }
        return await res.json();
      } catch (error) {
        this.logger.warn(`Nominatim not reached: ${(error as Error)?.name ?? 'error'}`);
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    };
    const next = this.nominatimQueue.then(run, run);
    this.nominatimQueue = next.catch(() => undefined);
    return next;
  }

  /** OpenStreetMap Nominatim reverse lookup; cached; one request a second; null when it has nothing or fails. */
  async reverse(latitude: number, longitude: number): Promise<ReverseAddress | null> {
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    const cached = this.addressCache.get(key);
    if (cached && this.now() - cached.at < CACHE_TTL_MS) return cached.value;
    const run = async (): Promise<ReverseAddress | null> => {
      const again = this.addressCache.get(key);
      if (again && this.now() - again.at < CACHE_TTL_MS) return again.value;
      const wait = this.lastNominatimAt + NOMINATIM_GAP_MS - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastNominatimAt = this.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const url = `${this.nominatimBase()}/reverse?format=jsonv2&lat=${encodeURIComponent(latitude.toFixed(6))}&lon=${encodeURIComponent(longitude.toFixed(6))}&zoom=18&addressdetails=1&accept-language=en`;
        const res = await this.fetcher()(url, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (res.status !== 200) {
          await res.body?.cancel?.().catch(() => undefined);
          this.logger.warn(`Nominatim answered ${res.status}`);
          return null;
        }
        const value = addressFromNominatim(await res.json());
        this.remember(this.addressCache, key, value);
        return value;
      } catch (error) {
        this.logger.warn(`Nominatim not reached: ${(error as Error)?.name ?? 'error'}`);
        return null;
      } finally {
        clearTimeout(timer);
      }
    };
    // One at a time, so the gap holds even when several agents paste at once.
    const next = this.nominatimQueue.then(run, run);
    this.nominatimQueue = next.catch(() => undefined);
    return next;
  }

  private remember<T>(cache: Map<string, { at: number; value: T }>, key: string, value: T): void {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: this.now(), value });
  }
}
