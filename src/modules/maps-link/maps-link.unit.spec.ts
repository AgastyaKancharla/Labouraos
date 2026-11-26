import { addressFromNominatim, addressQueries, googlePlaceIdOf, placeFromGoogle, splitShareText, withoutHouseNumber, extractPin, isAllowedMapsUrl, isPrivateAddress, looksLikeLink, parseCoordinates, parseMapsUrl, placeNameOf, withScheme } from './maps-link';
import { BENGALURU_VIEWBOX, GOOGLE_PLACES_SEARCH_URL, MapsFetch, MapsLinkService, MAX_REDIRECTS, NOMINATIM_GAP_MS, TIMEOUT_MS, USER_AGENT, WHERE_PER_MINUTE } from './maps-link.service';

const u = (s: string) => new URL(s);

describe('Google Maps link (17 Nov): allowlist and the pin', () => {
  it('accepts only Google map hosts', () => {
    for (const ok of [
      'https://www.google.com/maps/place/X/@12.9,77.6,17z',
      'https://google.com/maps?q=12.9,77.6',
      'https://maps.google.com/?ll=12.9,77.6',
      'https://maps.app.goo.gl/AbCdEf123',
      'https://goo.gl/maps/AbCdEf123',
      'http://maps.google.com/?q=12.9,77.6',
      'https://www.google.co.in/maps/place/X/@12.9,77.6,17z',
      'https://google.co.in/maps?q=12.9,77.6',
      'https://maps.google.co.in/?ll=12.9,77.6',
    ]) expect([ok, isAllowedMapsUrl(u(ok))]).toEqual([ok, true]);
    for (const bad of [
      'https://evil.com/maps/@12.9,77.6',
      'https://www.google.com.evil.com/maps',
      'https://www.google.com/search?q=12.9,77.6',
      'https://goo.gl/AbCdEf',
      'https://maps.google.com:8443/?q=1,2',
      'https://user:pw@maps.google.com/?q=1,2',
      'ftp://maps.google.com/',
      'https://127.0.0.1/maps',
      'https://mapsXgoogle.com/maps',
      'https://maps.app.goo.gl.attacker.net/x',
      'https://www.google.co.in/search?q=12.9,77.6',
      'https://www.google.co.uk/maps/@12.9,77.6,15z',
      'https://google.co.in.evil.net/maps',
    ]) expect([bad, isAllowedMapsUrl(u(bad))]).toEqual([bad, false]);
  });

  it('finds the link inside shared text and refuses anything else', () => {
    expect(parseMapsUrl('Sri Sai Bakery https://maps.app.goo.gl/AbCdEf123 ')?.hostname).toBe('maps.app.goo.gl');
    expect(parseMapsUrl('not a link')).toBeNull();
    expect(parseMapsUrl('https://example.com/?q=12.9,77.6')).toBeNull();
    expect(parseMapsUrl(`https://maps.google.com/?q=${'1'.repeat(3000)}`)).toBeNull();
  });

  it('reads !3d!4d (the place) before @lat,lng (the map centre), then q= / ll=', () => {
    expect(extractPin(u('https://www.google.com/maps/place/Sri+Sai+Bakery/@12.9100,77.6000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d12.9116!4d77.6101'))).toEqual({
      latitude: 12.9116, longitude: 77.6101, placeName: 'Sri Sai Bakery',
    });
    expect(extractPin(u('https://www.google.com/maps/@12.9352,77.6245,15z'))).toMatchObject({ latitude: 12.9352, longitude: 77.6245, placeName: null });
    expect(extractPin(u('https://maps.google.com/?q=12.97,77.59'))).toMatchObject({ latitude: 12.97, longitude: 77.59 });
    expect(extractPin(u('https://maps.google.com/?ll=12.97,77.59&z=16'))).toMatchObject({ latitude: 12.97, longitude: 77.59 });
    expect(extractPin(u('https://www.google.com/maps/search/?api=1&query=12.95%2C77.61'))).toMatchObject({ latitude: 12.95, longitude: 77.61 });
    // A dropped pin shared as a search, or a place by coordinates.
    expect(extractPin(u('https://www.google.com/maps/search/12.9716,+77.5946?entry=tts'))).toMatchObject({ latitude: 12.9716, longitude: 77.5946 });
    expect(extractPin(u('https://www.google.co.in/maps/search/12.9716,77.5946'))).toMatchObject({ latitude: 12.9716, longitude: 77.5946 });
    expect(extractPin(u('https://www.google.com/maps/place/12.9116,77.6101/@12.9,77.6,17z'))).toMatchObject({ latitude: 12.9116, longitude: 77.6101 });
    expect(extractPin(u('https://www.google.com/maps/@?api=1&map_action=map&center=12.93,77.62&zoom=15'))).toMatchObject({ latitude: 12.93, longitude: 77.62 });
    expect(extractPin(u('https://www.google.com/maps/search/Hotel+Kamat'))).toBeNull();
    expect(extractPin(u('https://maps.app.goo.gl/AbCdEf123'))).toBeNull();
    expect(extractPin(u('https://maps.google.com/?q=Hotel+Kamat'))).toBeNull();
    expect(extractPin(u('https://maps.google.com/?q=95,77'))).toBeNull();
  });

  it('knows private addresses', () => {
    for (const a of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) expect([a, isPrivateAddress(a)]).toEqual([a, true]);
    for (const a of ['142.250.183.14', '2404:6800:4007:80a::200e']) expect([a, isPrivateAddress(a)]).toEqual([a, false]);
  });

  it('maps Nominatim\'s address onto the business form', () => {
    expect(addressFromNominatim({
      display_name: '12, 9th Cross Road, JP Nagar 6th Phase, Bengaluru, Karnataka, 560078, India',
      address: { house_number: '12', road: '9th Cross Road', neighbourhood: 'JP Nagar 6th Phase', suburb: 'JP Nagar', city: 'Bengaluru', state: 'Karnataka', postcode: '560 078' },
    })).toEqual({
      shopNumber: '12', street: '9th Cross Road, JP Nagar 6th Phase', area: 'JP Nagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560078',
      displayName: '12, 9th Cross Road, JP Nagar 6th Phase, Bengaluru, Karnataka, 560078, India',
      locality: 'JP Nagar 6th Phase, JP Nagar',
    });
    expect(addressFromNominatim({ error: 'Unable to geocode' })).toBeNull();
  });
});

class TestMaps extends MapsLinkService {
  t = 1_000_000;
  slept: number[] = [];
  protected now() {
    return this.t;
  }
  protected async sleep(ms: number) {
    this.slept.push(ms);
    this.t += ms;
  }
}

type Call = { url: string; init: Parameters<MapsFetch>[1] };
function fakeFetch(routes: Record<string, { status: number; location?: string; json?: unknown }>) {
  const calls: Call[] = [];
  const fetch: MapsFetch = async (url, init) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) throw new Error(`unexpected fetch ${url}`);
    const r = routes[key];
    return { status: r.status, headers: { get: (n: string) => (n.toLowerCase() === 'location' ? r.location ?? null : null) }, json: async () => r.json, body: null };
  };
  return { fetch, calls };
}
const publicDns = async () => ['142.250.183.14'];
const NOM = 'https://nominatim.openstreetmap.org/reverse';
const nominatim = { status: 200, json: { display_name: 'X', address: { road: 'MG Road', suburb: 'Ashok Nagar', city: 'Bengaluru', postcode: '560001' } } };

describe('MapsLinkService', () => {
  it('a full link needs no opening: pin from the link, address from Nominatim with the Laboura User-Agent', async () => {
    const { fetch, calls } = fakeFetch({ [NOM]: nominatim });
    const maps = new TestMaps(fetch, publicDns);
    const out = await maps.resolve('fa-1', 'https://www.google.com/maps/place/Cafe/@12.97,77.60,17z/data=!3d12.9751!4d77.6062');
    expect(out).toMatchObject({ latitude: 12.9751, longitude: 77.6062, placeName: 'Cafe', shortLink: false, address: { street: 'MG Road', area: 'Ashok Nagar', pincode: '560001' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${NOM}?format=jsonv2&lat=12.975100&lon=77.606200&zoom=18&addressdetails=1&accept-language=en`);
    expect(calls[0].init.headers['User-Agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^Laboura\//);
  });

  it('follows a short link through Google hosts only, then caches the address (no second Nominatim call)', async () => {
    const { fetch, calls } = fakeFetch({
      'https://maps.app.goo.gl/AbC': { status: 302, location: 'https://www.google.com/maps/place/Hotel/@12.9,77.6,17z/data=!3d12.9116!4d77.6101?entry=tts' },
      [NOM]: nominatim,
    });
    const maps = new TestMaps(fetch, publicDns);
    const first = await maps.resolve('fa-1', 'https://maps.app.goo.gl/AbC');
    expect(first).toMatchObject({ latitude: 12.9116, longitude: 77.6101, shortLink: true });
    expect(calls[0].init).toMatchObject({ redirect: 'manual', method: 'GET' });
    await maps.resolve('fa-1', 'https://maps.app.goo.gl/AbC');
    expect(calls.map((c) => c.url.split('?')[0])).toEqual(['https://maps.app.goo.gl/AbC', NOM]);
  });

  it('never follows a redirect to another host, and refuses private addresses', async () => {
    const off = fakeFetch({ 'https://maps.app.goo.gl/Evil': { status: 302, location: 'http://169.254.169.254/latest/meta-data' } });
    await expect(new TestMaps(off.fetch, publicDns).resolve('fa-1', 'https://maps.app.goo.gl/Evil')).rejects.toMatchObject({ response: { code: 'MAPS_LINK_NO_LOCATION' } });
    expect(off.calls).toHaveLength(1);

    const rebound = fakeFetch({});
    await expect(new TestMaps(rebound.fetch, async () => ['10.1.2.3']).resolve('fa-1', 'https://maps.app.goo.gl/Rebind')).rejects.toMatchObject({ response: { code: 'MAPS_LINK_UNREACHABLE' } });
    expect(rebound.calls).toHaveLength(0);
  });

  it(`stops after ${MAX_REDIRECTS} redirects`, async () => {
    const loop = fakeFetch({ 'https://maps.app.goo.gl/': { status: 302, location: 'https://maps.app.goo.gl/again' } });
    await expect(new TestMaps(loop.fetch, publicDns).resolve('fa-1', 'https://maps.app.goo.gl/start')).rejects.toMatchObject({ response: { code: 'MAPS_LINK_NO_LOCATION' } });
    expect(loop.calls).toHaveLength(MAX_REDIRECTS);
  });

  it(`gives up after ${TIMEOUT_MS / 1000} s (the request is aborted)`, async () => {
    jest.useFakeTimers();
    try {
      const fetch: MapsFetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      const pending = new TestMaps(fetch, publicDns).resolve('fa-1', 'https://maps.app.goo.gl/Slow');
      const expectation = expect(pending).rejects.toMatchObject({ response: { code: 'MAPS_LINK_UNREACHABLE' } });
      await jest.advanceTimersByTimeAsync(TIMEOUT_MS + 10);
      await expectation;
    } finally {
      jest.useRealTimers();
    }
  });

  it('a link with no pin, or not a Maps link, is refused with its code (the page body is never read)', async () => {
    const json = jest.fn(async () => ({ lat: 1 }));
    const page = fakeFetch({ 'https://maps.google.com/': { status: 200 } });
    const pageFetch: MapsFetch = async (url, init) => ({ ...(await page.fetch(url, init)), json });
    // 21 Nov: a link with only a place name is looked up by that name; not found → refused with its code.
    const noPlace = fakeFetch({ 'https://maps.google.com/': { status: 200 }, 'https://nominatim.openstreetmap.org/search': { status: 200, json: [] } });
    await expect(new TestMaps(noPlace.fetch, publicDns).resolve('fa-1', 'https://maps.google.com/?q=Hotel+Kamat')).rejects.toMatchObject({
      response: { code: 'MAPS_LINK_NO_LOCATION', message: expect.stringContaining('Couldn’t find the place in this link') },
    });
    expect(noPlace.calls.some((c) => c.url.startsWith('https://maps.google.com/'))).toBe(false);
    // A link with neither a pin nor a name is opened, and with nothing found says so.
    await expect(new TestMaps(pageFetch, publicDns).resolve('fa-1', 'https://maps.google.com/?z=12')).rejects.toMatchObject({
      response: { code: 'MAPS_LINK_NO_LOCATION', message: 'This link has no map pin. In Google Maps, long-press to drop a pin, then share that.' },
    });
    expect(json).not.toHaveBeenCalled();
    const short = fakeFetch({ 'https://maps.app.goo.gl/Search': { status: 302, location: 'https://www.google.com/maps/search/Hotel+Kamat?entry=tts' }, 'https://www.google.com/maps/search': { status: 200 }, 'https://nominatim.openstreetmap.org/search': { status: 200, json: [] } });
    await expect(new TestMaps(short.fetch, publicDns).resolve('fa-1', 'https://maps.app.goo.gl/Search')).rejects.toMatchObject({ response: { code: 'MAPS_LINK_NO_LOCATION' } });
    await expect(new TestMaps(page.fetch, publicDns).resolve('fa-1', 'https://bing.com/maps?cp=12.9~77.6')).rejects.toMatchObject({ response: { code: 'MAPS_LINK_INVALID' } });
    await expect(new TestMaps(page.fetch, publicDns).resolve('fa-1', 42)).rejects.toMatchObject({ response: { code: 'MAPS_LINK_INVALID' } });
  });

  it('keeps Nominatim to one request a second, and a failed lookup still returns the pin', async () => {
    const { fetch, calls } = fakeFetch({ [NOM]: nominatim });
    const maps = new TestMaps(fetch, publicDns);
    await Promise.all([maps.reverse(12.1, 77.1), maps.reverse(12.2, 77.2), maps.reverse(12.3, 77.3)]);
    expect(calls).toHaveLength(3);
    expect(maps.slept.every((ms) => ms <= NOMINATIM_GAP_MS)).toBe(true);
    expect(maps.slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2 * NOMINATIM_GAP_MS - 1);

    const down = fakeFetch({ [NOM]: { status: 503 } });
    await expect(new TestMaps(down.fetch, publicDns).resolve('fa-2', 'https://maps.google.com/?q=12.97,77.59')).resolves.toMatchObject({ latitude: 12.97, address: null });
  });

  it('is rate-limited per agent: 10 a minute', async () => {
    const { fetch } = fakeFetch({ [NOM]: nominatim });
    const maps = new TestMaps(fetch, publicDns);
    for (let i = 0; i < 10; i += 1) await maps.resolve('fa-1', `https://maps.google.com/?q=12.9${i},77.6`);
    await expect(maps.resolve('fa-1', 'https://maps.google.com/?q=12.5,77.6')).rejects.toMatchObject({ response: { code: 'TOO_MANY' }, status: 429 });
    await expect(maps.resolve('fa-2', 'https://maps.google.com/?q=12.5,77.6')).resolves.toBeTruthy();
    maps.t += 61_000;
    await expect(maps.resolve('fa-1', 'https://maps.google.com/?q=12.5,77.6')).resolves.toBeTruthy();
  });
});

const SEARCH = 'https://nominatim.openstreetmap.org/search';
const lalbagh = [{ lat: '12.9507', lon: '77.5848', display_name: 'Lalbagh Botanical Garden, Mavalli, Bengaluru, Karnataka, 560004, India', address: { road: 'Lalbagh Road', suburb: 'Mavalli', city: 'Bengaluru', state: 'Karnataka', postcode: '560004' } }];

describe('Set the map pin (21 Nov, rev 204): address, any Google Maps link, or coordinates', () => {
  it('reads coordinates on their own, never a house number or a pincode', () => {
    expect(parseCoordinates('12.9166, 77.6101')).toEqual({ latitude: 12.9166, longitude: 77.6101 });
    expect(parseCoordinates('12.9166 77.6101')).toEqual({ latitude: 12.9166, longitude: 77.6101 });
    expect(parseCoordinates('(12.916600,77.610100)')).toEqual({ latitude: 12.9166, longitude: 77.6101 });
    expect(parseCoordinates('12.9166° N, 77.6101° E')).toEqual({ latitude: 12.9166, longitude: 77.6101 });
    expect(parseCoordinates('12, 5th Cross, 560078')).toBeNull();
    expect(parseCoordinates('12 560078')).toBeNull();
    expect(parseCoordinates('95.1, 77.1')).toBeNull();
  });

  it('knows a link with or without https://, and reads place names from /place/, /search/ and q=', () => {
    expect(looksLikeLink('maps.app.goo.gl/AbC12')).toBe(true);
    expect(looksLikeLink('Shop https://maps.app.goo.gl/AbC12')).toBe(true);
    expect(looksLikeLink('24th Main, JP Nagar, Bengaluru')).toBe(false);
    expect(withScheme('maps.app.goo.gl/AbC12')).toBe('https://maps.app.goo.gl/AbC12');
    expect(withScheme('Shop www.google.com/maps/@12.9,77.6,15z')).toBe('Shop https://www.google.com/maps/@12.9,77.6,15z');
    expect(placeNameOf(u('https://www.google.co.in/maps/place/MG+Road,+Bengaluru'))).toBe('MG Road, Bengaluru');
    expect(placeNameOf(u('https://www.google.com/maps/search/Hotel+Kamat?entry=tts'))).toBe('Hotel Kamat');
    expect(placeNameOf(u('https://maps.google.com/?q=Hotel+Kamat'))).toBe('Hotel Kamat');
    expect(placeNameOf(u('https://www.google.com/maps/search/12.9716,+77.5946'))).toBeNull();
  });

  it('coordinates: the pin as typed, with the address line it matched', async () => {
    const { fetch, calls } = fakeFetch({ [NOM]: nominatim });
    const out = await new TestMaps(fetch, publicDns).locate('ca-1', ' 12.9116, 77.6101 ');
    expect(out).toMatchObject({ latitude: 12.9116, longitude: 77.6101, source: 'coordinates', matched: 'X', shortLink: false });
    expect(calls.map((c) => c.url.split('?')[0])).toEqual([NOM]);
  });

  it('every real Google Maps link shape gives its pin', async () => {
    const shapes: Array<[string, number, number]> = [
      ['https://www.google.com/maps/place/Lalbagh+Botanical+Garden/@12.9507432,77.5847773,17z/data=!3m1!4b1!4m6!3m5!1s0x3bae15c8b5bb8e43:0x6e6c6f5a5c3f8a2b!8m2!3d12.9507432!4d77.5847773!16zL20vMDJ5eF9n?entry=ttu', 12.9507432, 77.5847773],
      ['https://www.google.com/maps/@12.9352,77.6245,15z?entry=ttu', 12.9352, 77.6245],
      ['https://maps.google.com/?q=12.9716,77.5946', 12.9716, 77.5946],
      ['https://www.google.com/maps?q=12.9716,77.5946&z=17', 12.9716, 77.5946],
      ['https://www.google.com/maps/search/?api=1&query=12.9716%2C77.5946', 12.9716, 77.5946],
      ['https://www.google.co.in/maps/search/12.9716,+77.5946?entry=tts', 12.9716, 77.5946],
      ['Sri Sai Bakery https://www.google.com/maps/place/Sri+Sai+Bakery/@12.91,77.60,17z/data=!8m2!3d12.9116!4d77.6101', 12.9116, 77.6101],
    ];
    for (const [link, latitude, longitude] of shapes) {
      const { fetch, calls } = fakeFetch({ [NOM]: nominatim });
      const out = await new TestMaps(fetch, publicDns).locate('ca-1', link);
      expect([link, out.latitude, out.longitude, out.source]).toEqual([link, latitude, longitude, 'link']);
      // A full link is never opened: only the address lookup.
      expect(calls.map((c) => c.url.split('?')[0])).toEqual([NOM]);
    }
  });

  it('short links (maps.app.goo.gl, goo.gl/maps, pasted without https://) are followed through Google hosts only', async () => {
    const { fetch, calls } = fakeFetch({
      'https://goo.gl/maps/AbCdEf123': { status: 301, location: 'https://maps.app.goo.gl/XyZ987' },
      'https://maps.app.goo.gl/XyZ987': { status: 302, location: 'https://www.google.com/maps/place/Hotel/@12.9,77.6,17z/data=!3d12.9116!4d77.6101?entry=tts' },
      'https://maps.app.goo.gl/Plain': { status: 302, location: 'https://maps.google.com/maps?q=12.93,77.62&ftid=0x0:0x1' },
      [NOM]: nominatim,
    });
    const maps = new TestMaps(fetch, publicDns);
    await expect(maps.locate('ca-1', 'https://goo.gl/maps/AbCdEf123')).resolves.toMatchObject({ latitude: 12.9116, longitude: 77.6101, shortLink: true, source: 'link' });
    await expect(maps.locate('ca-1', 'maps.app.goo.gl/Plain')).resolves.toMatchObject({ latitude: 12.93, longitude: 77.62, shortLink: true });
    expect(calls.map((c) => c.url.split('?')[0])).toEqual(['https://goo.gl/maps/AbCdEf123', 'https://maps.app.goo.gl/XyZ987', NOM, 'https://maps.app.goo.gl/Plain', NOM]);
    expect(calls.filter((c) => !c.url.startsWith(NOM)).every((c) => c.init.redirect === 'manual')).toBe(true);
  });

  it('a short link that ends on a place name only is looked up by that name', async () => {
    const { fetch, calls } = fakeFetch({
      'https://maps.app.goo.gl/Name': { status: 302, location: 'https://www.google.com/maps/search/Lalbagh+Botanical+Garden?entry=tts' },
      'https://www.google.com/maps/search': { status: 200 },
      [SEARCH]: { status: 200, json: lalbagh },
    });
    const out = await new TestMaps(fetch, publicDns).locate('ca-1', 'https://maps.app.goo.gl/Name');
    expect(out).toMatchObject({ latitude: 12.9507, longitude: 77.5848, placeName: 'Lalbagh Botanical Garden', source: 'link', matched: expect.stringContaining('Lalbagh') });
    const search = calls.find((c) => c.url.startsWith(SEARCH))!;
    expect(search.url).toContain('q=Lalbagh%20Botanical%20Garden');
    expect(search.url).toContain('countrycodes=in');
  });

  it('a full link with only a place name is looked up without opening the link', async () => {
    const { fetch, calls } = fakeFetch({ [SEARCH]: { status: 200, json: lalbagh } });
    const out = await new TestMaps(fetch, publicDns).locate('ca-1', 'https://www.google.co.in/maps/place/Lalbagh+Botanical+Garden');
    expect(out).toMatchObject({ latitude: 12.9507, longitude: 77.5848, source: 'link' });
    expect(calls.every((c) => c.url.startsWith(SEARCH))).toBe(true);
  });

  it('a typed address: Bengaluru first (bounded box), then anywhere in India; cached', async () => {
    const answers = [[], lalbagh];
    const calls: string[] = [];
    const fetch: MapsFetch = async (url) => {
      calls.push(url);
      return { status: 200, headers: { get: () => null }, json: async () => answers.shift() ?? [] };
    };
    const maps = new TestMaps(fetch, publicDns);
    const out = await maps.locate('ca-1', 'Lalbagh Road, Mavalli');
    expect(out).toMatchObject({ latitude: 12.9507, longitude: 77.5848, source: 'address', matched: expect.stringContaining('Mavalli'), address: { pincode: '560004' } });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(`viewbox=${BENGALURU_VIEWBOX}&bounded=1`);
    expect(calls[0]).toContain('countrycodes=in');
    expect(calls[1]).not.toContain('bounded=1');
    await maps.locate('ca-1', 'lalbagh road,   mavalli');
    expect(calls).toHaveLength(2);
  });

  it('an address that is not found, a link to another site, empty text and Nominatim down are refused with their codes', async () => {
    const empty = fakeFetch({ [SEARCH]: { status: 200, json: [] } });
    await expect(new TestMaps(empty.fetch, publicDns).locate('ca-1', 'Nowhere Street 99')).rejects.toMatchObject({ response: { code: 'MAPS_ADDRESS_NOT_FOUND' }, status: 422 });
    await expect(new TestMaps(empty.fetch, publicDns).locate('ca-1', 'https://example.com/maps/@12.9,77.6')).rejects.toMatchObject({ response: { code: 'MAPS_LINK_INVALID' }, status: 400 });
    await expect(new TestMaps(empty.fetch, publicDns).locate('ca-1', '   ')).rejects.toMatchObject({ response: { code: 'MAPS_TEXT_EMPTY' }, status: 400 });
    // An answer outside India is never used.
    const abroad = fakeFetch({ [SEARCH]: { status: 200, json: [{ lat: '51.5', lon: '-0.12', display_name: 'London' }] } });
    await expect(new TestMaps(abroad.fetch, publicDns).locate('ca-1', 'Baker Street')).rejects.toMatchObject({ response: { code: 'MAPS_ADDRESS_NOT_FOUND' } });
    const down = fakeFetch({ [SEARCH]: { status: 503 } });
    await expect(new TestMaps(down.fetch, publicDns).locate('ca-1', 'JP Nagar')).rejects.toMatchObject({ response: { code: 'MAPS_LOOKUP_UNAVAILABLE' }, status: 502 });
  });

  it('a short link redirected off Google is never followed further', async () => {
    const off = fakeFetch({ 'https://maps.app.goo.gl/Evil': { status: 302, location: 'https://attacker.example/x?q=12.9,77.6' } });
    await expect(new TestMaps(off.fetch, publicDns).locate('ca-1', 'https://maps.app.goo.gl/Evil')).rejects.toMatchObject({ response: { code: 'MAPS_LINK_NO_LOCATION' } });
    expect(off.calls).toHaveLength(1);
  });
});

describe('Business address from the field test (22 Nov)', () => {
  const SEARCH = 'https://nominatim.openstreetmap.org/search';
  const banashankari = [{ lat: '12.9255', lon: '77.5468', display_name: '45th Cross, Banashankari, Bengaluru', address: { road: '45th Cross', suburb: 'Banashankari', city: 'Bengaluru', postcode: '560070' } }];
  const kalena = [{ lat: '12.8890', lon: '77.5970', display_name: 'Kalena Agrahara, Bengaluru', address: { suburb: 'Kalena Agrahara', city: 'Bengaluru', postcode: '560076' } }];
  afterEach(() => {
    delete process.env.GOOGLE_PLACES_API_KEY;
  });

  it('drops house numbers but never ordinals', () => {
    expect(withoutHouseNumber('1273 45th Cross')).toBe('45th Cross');
    expect(withoutHouseNumber('64/44 BK Circle')).toBe('BK Circle');
    expect(withoutHouseNumber('#12-A, MG Road'.split(',')[0])).toBe('');
    expect(withoutHouseNumber('No. 5 Temple Street')).toBe('Temple Street');
    expect(withoutHouseNumber('Shop no 3 Main Road')).toBe('Main Road');
    expect(withoutHouseNumber('8th phase')).toBe('8th phase');
    expect(withoutHouseNumber('45th Cross')).toBe('45th Cross');
  });

  it('tries shorter and shorter queries, the locality and Bengaluru last', () => {
    expect(addressQueries('1273 45th Cross, Banashankari')).toEqual([
      '1273 45th Cross, Banashankari', '45th Cross, Banashankari, Bengaluru', 'Banashankari, Bengaluru',
    ]);
    expect(addressQueries('64/44 BK Circle, Kottanur, Surabhi Nagar, 8th phase, Kalani Agrahara, Bengaluru')).toEqual([
      '64/44 BK Circle, Kottanur, Surabhi Nagar, 8th phase, Kalani Agrahara, Bengaluru',
      'BK Circle, Kottanur, Surabhi Nagar, 8th phase, Kalani Agrahara, Bengaluru',
      'Kottanur, Surabhi Nagar, 8th phase, Kalani Agrahara, Bengaluru',
      'Surabhi Nagar, 8th phase, Kalani Agrahara, Bengaluru',
      '8th phase, Kalani Agrahara, Bengaluru',
    ]);
    expect(addressQueries('12 MG Road, Bangalore 560001')).toEqual(['12 MG Road, Bangalore 560001', 'MG Road, Bengaluru']);
    expect(addressQueries('   ')).toEqual([]);
  });

  it('splits Google Maps share text into the link and the address', () => {
    expect(splitShareText('Sri Sai Bakery, 24th Main, JP Nagar https://maps.app.goo.gl/AbC123')).toEqual({ link: 'https://maps.app.goo.gl/AbC123', rest: 'Sri Sai Bakery, 24th Main, JP Nagar' });
    expect(splitShareText('Reddy Mess\nmaps.app.goo.gl/XyZ')).toEqual({ link: 'maps.app.goo.gl/XyZ', rest: 'Reddy Mess' });
    expect(splitShareText('Just an address')).toEqual({ link: null, rest: 'Just an address' });
  });

  it('"1273 45th Cross, Banashankari" is found once the house number is dropped', async () => {
    const calls: string[] = [];
    const fetch: MapsFetch = async (url) => {
      calls.push(url);
      const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
      return { status: 200, headers: { get: () => null }, json: async () => (q === '45th Cross, Banashankari, Bengaluru' ? banashankari : []) };
    };
    const out = await new TestMaps(fetch, publicDns).locate('fa-1', '1273 45th Cross, Banashankari');
    expect(out).toMatchObject({ source: 'address', latitude: 12.9255, address: { pincode: '560070', area: 'Banashankari' } });
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain(`viewbox=${BENGALURU_VIEWBOX}&bounded=1`);
  });

  it('the long Kottanur address finds its locality', async () => {
    const fetch: MapsFetch = async (url) => {
      const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
      return { status: 200, headers: { get: () => null }, json: async () => (q.startsWith('8th phase, Kalani Agrahara') ? kalena : []) };
    };
    const out = await new TestMaps(fetch, publicDns).locate('fa-1', '64/44 BK Circle, Kottanur, Surabhi Nagar, 8th phase, Kalani Agrahara, Bengaluru');
    expect(out).toMatchObject({ source: 'address', latitude: 12.889, address: { pincode: '560076' } });
  });

  it('pasted share text whose link cannot be opened is looked up by the address in it', async () => {
    const fetch: MapsFetch = async (url) => {
      if (url.startsWith('https://maps.app.goo.gl/')) throw new Error('blocked');
      const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
      return { status: 200, headers: { get: () => null }, json: async () => (q.includes('Banashankari') ? banashankari : []) };
    };
    const out = await new TestMaps(fetch, publicDns).locate('fa-1', 'Andhra Ruchulu, 45th Cross, Banashankari https://maps.app.goo.gl/AbC123');
    expect(out).toMatchObject({ source: 'address', latitude: 12.9255 });
  });

  it('"where am I": the area in words for a GPS fix, with its own per-agent limit', async () => {
    const { fetch, calls } = fakeFetch({
      [NOM]: { status: 200, json: { display_name: 'Kothnur, JP Nagar 8th Phase, Bengaluru', address: { road: '24th Main', neighbourhood: 'Kothnur', suburb: 'JP Nagar 8th Phase', city: 'Bengaluru', postcode: '560076' } } },
    });
    const maps = new TestMaps(fetch, publicDns);
    const out = await maps.where('fa-1', 12.8901, 77.5902);
    expect(out).toMatchObject({ area: 'Kothnur, JP Nagar 8th Phase', address: { street: '24th Main, Kothnur', pincode: '560076', city: 'Bengaluru' } });
    await expect(maps.where('fa-1', 'x', 77.59)).rejects.toMatchObject({ response: { code: 'MAPS_POINT_INVALID' }, status: 400 });
    await expect(maps.where('fa-1', 0, 0)).rejects.toMatchObject({ status: 400 });
    // Cached: the same spot is never looked up twice.
    await maps.where('fa-1', 12.8901, 77.5902);
    expect(calls).toHaveLength(1);
    for (let i = 2; i < WHERE_PER_MINUTE; i += 1) await maps.where('fa-1', 12.8901, 77.5902);
    await expect(maps.where('fa-1', 12.8901, 77.5902)).rejects.toMatchObject({ status: 429 });
    // Links and addresses keep their own limit.
    await expect(maps.where('fa-2', 12.8901, 77.5902)).resolves.toBeTruthy();
  });

  it('26 Nov: "where am I" fills the gaps from a wider lookup, then Google nearby; never a neighbour\'s shop number', async () => {
    const seen: string[] = [];
    const answer = (json: unknown) => ({ status: 200, headers: { get: () => null }, json: async () => json, body: null });
    const reply = (zoom16: unknown, google?: unknown): MapsFetch => async (url) => {
      seen.push(url);
      if (url.startsWith(NOM) && url.includes('zoom=18')) return answer({ display_name: '12, 24th Main', address: { house_number: '12', road: '24th Main', city: 'Bengaluru' } });
      if (url.startsWith(NOM) && url.includes('zoom=16')) return answer(zoom16);
      if (url.startsWith('https://places.googleapis.com/v1/places:searchNearby')) return answer(google ?? { places: [] });
      throw new Error(`unexpected fetch ${url}`);
    };
    // The exact spot has no area or PIN code; the wider lookup has both.
    delete process.env.GOOGLE_PLACES_API_KEY;
    let maps = new TestMaps(reply({ address: { house_number: '99', suburb: 'JP Nagar 8th Phase', city: 'Bengaluru', postcode: '560076' } }), publicDns);
    let out = await maps.where('fa-1', 12.8901, 77.5902);
    expect(out.address).toMatchObject({ shopNumber: '12', street: '24th Main', area: 'JP Nagar 8th Phase', pincode: '560076', city: 'Bengaluru' });
    expect(out).toMatchObject({ latitude: 12.8901, longitude: 77.5902 });
    expect(seen.some((u) => u.includes('places.googleapis.com'))).toBe(false);

    // Still no PIN code: Google nearby (only with the key) fills it; the pin stays the GPS fix.
    process.env.GOOGLE_PLACES_API_KEY = 'test-key-not-real';
    seen.length = 0;
    maps = new TestMaps(reply({ address: { suburb: 'JP Nagar 8th Phase' } }, {
      places: [{ location: { latitude: 12.8905, longitude: 77.5907 }, formattedAddress: '7, 24th Main, Kothnur, Bengaluru 560076', addressComponents: [
        { longText: '7', types: ['street_number'] }, { longText: '560076', types: ['postal_code'] }, { longText: 'Bengaluru', types: ['locality'] },
      ] }],
    }), publicDns);
    out = await maps.where('fa-1', 12.8901, 77.5902);
    expect(out.address).toMatchObject({ shopNumber: '12', area: 'JP Nagar 8th Phase', pincode: '560076' });
    expect(out).toMatchObject({ latitude: 12.8901, longitude: 77.5902 });
    expect(seen.filter((u) => u.includes('places:searchNearby'))).toHaveLength(1);

    // OpenStreetMap down entirely: Google alone still fills the form, without its shop number.
    seen.length = 0;
    const down: MapsFetch = async (url) => {
      seen.push(url);
      if (url.startsWith(NOM)) return { status: 503, headers: { get: () => null }, json: async () => ({}), body: null };
      return answer({ places: [{ location: { latitude: 12.95, longitude: 77.6 }, addressComponents: [
        { longText: '7', types: ['street_number'] }, { longText: '100 Feet Road', types: ['route'] }, { longText: 'Indiranagar', types: ['sublocality_level_1'] },
        { longText: '560038', types: ['postal_code'] }, { longText: 'Bengaluru', types: ['locality'] },
      ] }] });
    };
    out = await new TestMaps(down, publicDns).where('fa-1', 12.95, 77.6);
    expect(out.address).toMatchObject({ shopNumber: null, street: '100 Feet Road', area: 'Indiranagar', pincode: '560038', city: 'Bengaluru' });
    delete process.env.GOOGLE_PLACES_API_KEY;
  });

  it('with GOOGLE_PLACES_API_KEY, a typed address uses Google Places server-side (key in a header only)', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key-not-real';
    const calls: Array<{ url: string; init: Parameters<MapsFetch>[1] }> = [];
    const fetch: MapsFetch = async (url, init) => {
      calls.push({ url, init });
      return {
        status: 200, headers: { get: () => null }, json: async () => ({
          places: [{
            id: 'ChIJabc', formattedAddress: '1273, 45th Cross Rd, Bendre Nagar, Banashankari, Bengaluru, Karnataka 560070, India',
            location: { latitude: 12.9251, longitude: 77.5466 },
            addressComponents: [
              { longText: '1273', types: ['street_number'] }, { longText: '45th Cross Road', types: ['route'] },
              { longText: 'Bendre Nagar', types: ['sublocality_level_2', 'sublocality'] }, { longText: 'Banashankari', types: ['sublocality_level_1', 'sublocality'] },
              { longText: 'Bengaluru', types: ['locality'] }, { longText: 'Karnataka', types: ['administrative_area_level_1'] }, { longText: '560070', types: ['postal_code'] },
            ],
          }],
        }),
      };
    };
    const out = await new TestMaps(fetch, publicDns).locate('ca-1', '1273 45th Cross, BENDRANAGA');
    expect(out).toMatchObject({ latitude: 12.9251, address: { shopNumber: '1273', street: '45th Cross Road, Bendre Nagar', area: 'Banashankari', city: 'Bengaluru', pincode: '560070', locality: 'Bendre Nagar, Banashankari' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(GOOGLE_PLACES_SEARCH_URL);
    expect(calls[0].url).not.toContain('test-key');
    expect(calls[0].init).toMatchObject({ method: 'POST', headers: { 'X-Goog-Api-Key': 'test-key-not-real' } });
    expect(JSON.parse(calls[0].init.body ?? '{}')).toMatchObject({ textQuery: '1273 45th Cross, BENDRANAGA', regionCode: 'IN' });
  });

  it('Google failing falls back to OpenStreetMap; no key means Google is never called', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key-not-real';
    const urls: string[] = [];
    const fetch: MapsFetch = async (url) => {
      urls.push(url);
      if (url.startsWith('https://places.googleapis.com')) return { status: 403, headers: { get: () => null }, json: async () => ({}) };
      return { status: 200, headers: { get: () => null }, json: async () => banashankari };
    };
    const out = await new TestMaps(fetch, publicDns).locate('ca-1', '45th Cross, Banashankari');
    expect(out).toMatchObject({ latitude: 12.9255 });
    expect(urls[0]).toBe(GOOGLE_PLACES_SEARCH_URL);
    expect(urls[1]).toContain(SEARCH);
    delete process.env.GOOGLE_PLACES_API_KEY;
    const plain: string[] = [];
    await new TestMaps(async (url) => {
      plain.push(url);
      return { status: 200, headers: { get: () => null }, json: async () => banashankari };
    }, publicDns).locate('ca-1', '45th Cross, Banashankari');
    expect(plain.every((u) => u.startsWith(SEARCH))).toBe(true);
  });

  it('reads Google place answers and place ids in links', () => {
    expect(placeFromGoogle({ location: { latitude: 51.5, longitude: -0.1 } })).toBeNull();
    expect(placeFromGoogle(null)).toBeNull();
    expect(googlePlaceIdOf(new URL('https://www.google.com/maps/search/?api=1&query=Cafe&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4'))).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
    expect(googlePlaceIdOf(new URL('https://maps.google.com/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4'))).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
    expect(googlePlaceIdOf(new URL('https://maps.google.com/?q=Cafe'))).toBeNull();
  });
});
