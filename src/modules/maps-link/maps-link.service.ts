import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { lookup as dnsLookup } from 'dns/promises';
import { codedError } from '../../common/http/coded-error';
import {
  addressFromNominatim,
  extractPin,
  isAllowedMapsUrl,
  isPrivateAddress,
  isShortMapsUrl,
  MapsPin,
  parseMapsUrl,
  ReverseAddress,
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
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;

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
    const url = typeof text === 'string' ? parseMapsUrl(text) : null;
    if (!url) throw codedError(HttpStatus.BAD_REQUEST, 'MAPS_LINK_INVALID', 'Paste a Google Maps link (google.com/maps, maps.google.com, maps.app.goo.gl or goo.gl/maps)');
    const shortLink = isShortMapsUrl(url);
    let pin = extractPin(url);
    if (!pin) pin = await this.follow(url);
    if (!pin) throw codedError(HttpStatus.UNPROCESSABLE_ENTITY, 'MAPS_LINK_NO_LOCATION', 'No location was found in this link');
    const address = await this.reverse(pin.latitude, pin.longitude);
    return { latitude: pin.latitude, longitude: pin.longitude, placeName: pin.placeName, address, shortLink };
  }

  /** At most LINKS_PER_MINUTE a minute and LINKS_PER_DAY a day per agent. */
  private claim(staffId: string): void {
    const now = this.now();
    const recent = (this.perAgent.get(staffId) ?? []).filter((t) => now - t < 24 * 60 * 60 * 1000);
    const lastMinute = recent.filter((t) => now - t < 60 * 1000).length;
    if (lastMinute >= LINKS_PER_MINUTE || recent.length >= LINKS_PER_DAY) {
      this.perAgent.set(staffId, recent);
      throw codedError(HttpStatus.TOO_MANY_REQUESTS, 'TOO_MANY', 'Too many links in a short time. Wait a minute and try again.', {
        retryAfterSeconds: recent.length >= LINKS_PER_DAY ? 24 * 60 * 60 : 60,
      });
    }
    recent.push(now);
    this.perAgent.set(staffId, recent);
    if (this.perAgent.size > 10_000) {
      for (const [id, times] of this.perAgent) if (!times.some((t) => now - t < 24 * 60 * 60 * 1000)) this.perAgent.delete(id);
    }
  }

  /**
   * Opens a link that has no pin in it (a short link), following redirects by
   * hand so each hop is checked: Google map hosts only, https, a public
   * address, at most MAX_REDIRECTS, TIMEOUT_MS for the whole chain. The body
   * is never read.
   */
  private async follow(start: URL): Promise<MapsPin | null> {
    const key = start.toString();
    const cached = this.linkCache.get(key);
    if (cached && this.now() - cached.at < CACHE_TTL_MS) return cached.value;
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
          return found;
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
        if (!location) return null;
        current = new URL(location, current);
      }
      throw codedError(HttpStatus.UNPROCESSABLE_ENTITY, 'MAPS_LINK_NO_LOCATION', 'Too many redirects');
    } catch (error) {
      if (error && typeof (error as { getStatus?: unknown }).getStatus === 'function') throw error;
      this.logger.warn(`Maps link not opened: ${(error as Error)?.name ?? 'error'}`);
      throw codedError(HttpStatus.BAD_GATEWAY, 'MAPS_LINK_UNREACHABLE', 'The link could not be opened');
    } finally {
      clearTimeout(timer);
    }
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
