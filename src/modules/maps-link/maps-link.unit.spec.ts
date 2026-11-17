import { addressFromNominatim, extractPin, isAllowedMapsUrl, isPrivateAddress, parseMapsUrl } from './maps-link';
import { MapsFetch, MapsLinkService, MAX_REDIRECTS, NOMINATIM_GAP_MS, TIMEOUT_MS, USER_AGENT } from './maps-link.service';

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

  it('a link with no pin, or not a Maps link, is refused with its code', async () => {
    const page = fakeFetch({ 'https://maps.google.com/': { status: 200 } });
    await expect(new TestMaps(page.fetch, publicDns).resolve('fa-1', 'https://maps.google.com/?q=Hotel+Kamat')).rejects.toMatchObject({ response: { code: 'MAPS_LINK_NO_LOCATION' } });
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
