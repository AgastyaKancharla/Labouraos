import { Controller, Get, INestApplication, MiddlewareConsumer, Module, NestModule, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as request from 'supertest';
import { CloudflareAccessVerifier } from '../../common/auth/cloudflare-access.verifier';
import { resolveFieldAppFile } from '../field-app/field-app.files';
import { fieldHosts, isFieldHost, normaliseHost } from './site-hosts';
import { fieldAppAddress, retiredConsoleRedirect, routeSiteRequest, SiteRoutingMiddleware, WEB_APP_ROOTS } from './site-routing.middleware';
import { resolveWebAppFile } from './web-app.files';

/** Stand-ins for API routes that share a first segment with the web app's pages. */
@Controller()
class FakeApiController {
  @Get('ceo/pricing/history')
  pricingHistory() {
    return { api: 'ceo pricing' };
  }

  @Get('call-agent')
  callAgentApi() {
    return { api: 'call-agent segment' };
  }

  @Get('console/admin')
  oldAdmin() {
    return { page: 'old admin dashboard' };
  }

  @Get('field-work/home')
  fieldHome() {
    return { api: 'field home' };
  }

  @Post('auth/login')
  login() {
    return { api: 'login' };
  }

  @Get('finance/reports/books.csv')
  books() {
    return { api: 'books' };
  }
}

let cfAllows = true;
const fakeVerifier = { verify: () => (cfAllows ? Promise.resolve({}) : Promise.reject(new Error('bad'))) };

@Module({ controllers: [FakeApiController], providers: [SiteRoutingMiddleware, { provide: CloudflareAccessVerifier, useValue: fakeVerifier }] })
class SiteTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SiteRoutingMiddleware).forRoutes('*');
  }
}

const HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const RENDER = 'laboura-api.onrender.com';
const APP = 'app.laboura.com';
const FIELD = 'field.laboura.com';

describe('Web addresses (decided 14 Nov): app.laboura.com, field.laboura.com and the Render test address', () => {
  let tmp: string;
  let web: string;
  let field: string;
  let fieldRoot: string;
  let app: INestApplication;
  const saved = { ...process.env };

  function writeFiles(root: string, files: Record<string, string>) {
    for (const [name, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), body);
    }
  }

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laboura-site-'));
    web = path.join(tmp, 'web');
    field = path.join(tmp, 'field');
    fieldRoot = path.join(tmp, 'field-root');
    writeFiles(web, {
      'index.html': '<!doctype html><div id="root">office</div>',
      'assets/index-abc123.js': 'console.log("app")',
      'favicon.png': 'png',
      'logo-mark.png': 'png',
    });
    const fieldFiles = (base: string) => ({
      'index.html': `<!doctype html><div id="root">field ${base}</div>`,
      '_expo/static/js/web/entry-abc123.js': 'console.log("field")',
      'sw.js': 'self.addEventListener("fetch", () => {})',
      'register-sw.js': `navigator.serviceWorker.register("${base}sw.js")`,
      'manifest.webmanifest': `{"name":"Laboura Field","start_url":"${base}","scope":"${base}"}`,
      'icons/icon-192.png': 'png',
    });
    writeFiles(field, fieldFiles('/field/'));
    writeFiles(fieldRoot, fieldFiles('/'));
    fs.writeFileSync(path.join(tmp, 'secret.txt'), 'TOP-SECRET-CONTENT');
    process.env.WEB_DIST_DIR = web;
    process.env.FIELD_DIST_DIR = field;
    process.env.FIELD_ROOT_DIST_DIR = fieldRoot;
    process.env.FIELD_HOST = FIELD;
    delete process.env.CLOUDFLARE_ACCESS_ENFORCED;

    const moduleRef = await Test.createTestingModule({ imports: [SiteTestModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    cfAllows = true;
    delete process.env.CLOUDFLARE_ACCESS_ENFORCED;
  });

  const get = (host: string, url: string, accept = HTML) => request(app.getHttpServer()).get(url).set('Host', host).set('Accept', accept);

  describe('app.laboura.com and the Render test address: the office portals at the root', () => {
    it.each([RENDER, APP])('serves the login page, every portal and the public pages at the root on %s, never cached', async (host) => {
      for (const url of ['/', '/login', '/ceo', '/ceo/refunds', '/manager', '/team-lead/agents/a1', '/finance', '/call-agent', '/call-agent/register/job-seeker/JS-00203', '/p/register/tok123', '/p/invite/inv-1', '/p/partner/tok9', '/p/partner/tok9/selfie', '/field-app']) {
        const res = await get(host, url);
        expect([url, res.status]).toEqual([url, 200]);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.text).toContain('office');
      }
    });

    it('lists the web app roots the server answers', () => {
      expect([...WEB_APP_ROOTS]).toEqual(['login', 'ceo', 'manager', 'team-lead', 'finance', 'call-agent', 'p', 'field-app']);
    });

    it('serves hashed assets with a long cache, and the icons', async () => {
      const res = await get(APP, '/assets/index-abc123.js', '*/*');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.headers['cache-control']).toContain('immutable');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect((await get(APP, '/favicon.png', 'image/*')).status).toBe(200);
      expect((await get(RENDER, '/logo-mark.png', 'image/*')).status).toBe(200);
    });

    it('answers 404, not HTML, for a missing file', async () => {
      expect((await get(APP, '/assets/missing.js', '*/*')).status).toBe(404);
      expect((await get(APP, '/ceo/missing.js')).status).toBe(404);
    });

    it('never serves files outside web/dist', async () => {
      const res = await get(APP, '/assets/%2e%2e/%2e%2e/secret.txt', '*/*');
      expect(res.text).not.toContain('TOP-SECRET-CONTENT');
      expect(resolveWebAppFile(web, '/../secret.txt')).toEqual({ kind: 'missing' });
      expect(resolveWebAppFile(web, '/%2e%2e%2fsecret.txt')).toEqual({ kind: 'missing' });
      expect(resolveWebAppFile(web, '/%E0%A4%A')).toEqual({ kind: 'missing' });
    });

    it('leaves the API alone: its callers ask for JSON, even where the first segment is a portal', async () => {
      const pricing = await get(APP, '/ceo/pricing/history', 'application/json');
      expect(pricing.status).toBe(200);
      expect(pricing.body).toEqual({ api: 'ceo pricing' });
      expect((await get(RENDER, '/finance/reports/books.csv', '*/*')).body).toEqual({ api: 'books' });
      expect((await get(RENDER, '/call-agent', 'application/json')).body).toEqual({ api: 'call-agent segment' });
      const login = await request(app.getHttpServer()).post('/auth/login').set('Host', APP).set('Accept', 'application/json').send({});
      expect(login.body).toEqual({ api: 'login' });
    });

    it('does not take over anything outside the web app', async () => {
      expect((await get(APP, '/application')).status).toBe(404);
      expect((await get(APP, '/administration')).status).toBe(404);
      expect((await get(APP, '/field-agents')).status).toBe(404);
      expect((await get(APP, '/fieldx')).status).toBe(404);
    });

    it('keeps the staff portals behind Cloudflare Access when enforced, but leaves the public pages open', async () => {
      process.env.CLOUDFLARE_ACCESS_ENFORCED = 'true';
      expect((await get(APP, '/ceo')).status).toBe(403);
      expect((await get(APP, '/login')).status).toBe(403);
      expect((await get(APP, '/ceo').set('cf-access-jwt-assertion', 'signed')).status).toBe(200);
      cfAllows = false;
      expect((await get(APP, '/ceo').set('cf-access-jwt-assertion', 'forged')).status).toBe(403);
      expect((await get(APP, '/p/register/tok123')).status).toBe(200);
      expect((await get(APP, '/assets/index-abc123.js', '*/*')).status).toBe(200);
    });

    it('says so clearly when the web app was not built', async () => {
      process.env.WEB_DIST_DIR = path.join(tmp, 'not-built');
      try {
        const res = await get(APP, '/ceo');
        expect(res.status).toBe(503);
        expect(res.body.message).toMatch(/not been built/);
      } finally {
        process.env.WEB_DIST_DIR = web;
      }
    });
  });

  describe('old /app links redirect permanently to the same page without /app', () => {
    it.each([
      ['/app', '/'],
      ['/app/', '/'],
      ['/app/ceo', '/ceo'],
      ['/app/ceo/refunds?tab=due', '/ceo/refunds?tab=due'],
      ['/app/login', '/login'],
      ['/app/p/invite/inv%2F1', '/p/invite/inv%2F1'],
      ['/app/p/register/tok123', '/p/register/tok123'],
      ['/app/p/partner/tok9?lang=kn', '/p/partner/tok9?lang=kn'],
      ['/app/p/fee/PAY-00001-ab12?lang=kn', '/p/fee/PAY-00001-ab12?lang=kn'],
      ['/app/assets/index-abc123.js', '/assets/index-abc123.js'],
    ])('%s → %s', async (from, to) => {
      for (const host of [APP, RENDER]) {
        const res = await get(host, from);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe(to);
      }
    });

    it('never redirects off the site', async () => {
      const res = await get(APP, '/app//evil.example/x');
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/evil.example/x');
    });

    it.each([
      '/app//evil.example/x',
      '/app/\\evil.example/x',
      '/app/\\/evil.example/x',
      '/app/%5Cevil.example/x',
      '/app/%2F%2Fevil.example/x',
    ])('never builds an off-site redirect from %s', (url) => {
      const outcome = routeSiteRequest({ method: 'GET', originalUrl: url, url, hostname: 'app.laboura.com', headers: { accept: 'text/html' } }, {});
      expect(outcome.kind).toBe('redirect');
      const location = (outcome as { location: string }).location;
      expect(location).toBe('/evil.example/x');
      expect(location.startsWith('//')).toBe(false);
      expect(location.startsWith('/\\')).toBe(false);
    });
  });

  describe('the retired one-page consoles (14 Nov): browsers are sent on, API calls are untouched', () => {
    it.each([
      ['/admin', '/login'],
      ['/admin/', '/login'],
      ['/map', '/login'],
      ['/console/map', '/login'],
      ['/console/call-agent', '/call-agent'],
      ['/field-agent', `https://${FIELD}/`],
      ['/console/field-agent', `https://${FIELD}/`],
    ])('%s → %s (301)', async (from, to) => {
      for (const host of [APP, RENDER]) {
        const res = await get(host, from);
        expect([host, res.status]).toEqual([host, 301]);
        expect(res.headers.location).toBe(to);
        expect(res.text).not.toMatch(/Admin Dashboard|Call Agent Console|Field Agent App/);
      }
    });

    it('serves the new web app, and nothing old, at /call-agent', async () => {
      const res = await get(APP, '/call-agent');
      expect(res.status).toBe(200);
      expect(res.text).toContain('office');
      expect(res.text).not.toContain('Call Agent Console');
    });

    it('sends the old field agent page to /field on this address while FIELD_HOST is not set', async () => {
      delete process.env.FIELD_HOST;
      try {
        const res = await get(RENDER, '/field-agent');
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/field/');
      } finally {
        process.env.FIELD_HOST = FIELD;
      }
      expect(fieldAppAddress({})).toBe('/field/');
      expect(fieldAppAddress({ FIELD_HOST: 'Field.Laboura.com, other.test' })).toBe('https://field.laboura.com/');
    });

    it('never redirects an API caller (the old /map and priority API routes are gone too, 14 Nov)', async () => {
      for (const url of ['/admin', '/map', '/field-agent', '/console/call-agent', '/console/field-agent', '/console/map']) {
        const res = await get(APP, url, 'application/json');
        expect([url, res.status]).toEqual([url, 404]);
      }
    });

    it('leaves /console/admin (the old dashboard, kept for what the new screens lack) to its controller', async () => {
      expect((await get(APP, '/console/admin')).body).toEqual({ page: 'old admin dashboard' });
      expect(retiredConsoleRedirect('/console/admin')).toBeNull();
      expect(retiredConsoleRedirect('/setup')).toBeNull();
    });

    it('on field.laboura.com sends the old field agent page to the root, and /map stays a Laboura Field page', async () => {
      for (const url of ['/field-agent', '/console/field-agent']) {
        const res = await get(FIELD, url);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/');
      }
      const map = await get(FIELD, '/map');
      expect(map.status).toBe(200);
      expect(map.text).toContain('field /');
    });
  });

  describe('the Render test address and app.laboura.com: Laboura Field at /field', () => {
    it('serves index.html for the app root and every screen URL, never cached', async () => {
      for (const url of ['/field', '/field/', '/field/login', '/field/visits', '/field/visit/start']) {
        const res = await get(RENDER, url);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.text).toContain('field /field/');
      }
    });

    it('caches hashed bundles forever; never the service worker (scope /field/), its installer or the manifest', async () => {
      const bundle = await get(RENDER, '/field/_expo/static/js/web/entry-abc123.js', '*/*');
      expect(bundle.headers['cache-control']).toContain('immutable');
      const sw = await get(RENDER, '/field/sw.js', '*/*');
      expect(sw.status).toBe(200);
      expect(sw.headers['cache-control']).toBe('no-cache');
      expect(sw.headers['service-worker-allowed']).toBe('/field/');
      expect((await get(RENDER, '/field/register-sw.js', '*/*')).headers['cache-control']).toBe('no-cache');
      const manifest = await get(RENDER, '/field/manifest.webmanifest', '*/*');
      expect(manifest.headers['content-type']).toMatch(/application\/manifest\+json/);
      expect(manifest.text).toContain('"scope":"/field/"');
    });

    it('answers 404, not HTML, for a missing file, and never serves files outside field/dist', async () => {
      expect((await get(RENDER, '/field/_expo/static/js/web/missing.js', '*/*')).status).toBe(404);
      expect((await get(RENDER, '/field/robots.txt')).status).toBe(404);
      expect((await get(RENDER, '/field/%2e%2e/%2e%2e/secret.txt')).text).not.toContain('TOP-SECRET-CONTENT');
      expect(resolveFieldAppFile(field, '/field/../secret.txt')).toEqual({ kind: 'missing' });
      expect(resolveFieldAppFile(field, '/field/%E0%A4%A')).toEqual({ kind: 'missing' });
      expect(resolveFieldAppFile(fieldRoot, '/../secret.txt', '')).toEqual({ kind: 'missing' });
    });

    it('says so clearly when the app was not built', async () => {
      process.env.FIELD_DIST_DIR = path.join(tmp, 'not-built');
      try {
        const res = await get(RENDER, '/field/login');
        expect(res.status).toBe(503);
        expect(res.body.message).toMatch(/not been built/);
      } finally {
        process.env.FIELD_DIST_DIR = field;
      }
    });
  });

  describe('field.laboura.com: Laboura Field at the root, installable, API on the same address', () => {
    it('serves the root build for every page a browser opens', async () => {
      for (const url of ['/', '/login', '/login-code', '/visits', '/visit/start', '/business/new']) {
        const res = await get(FIELD, url);
        expect([url, res.status]).toEqual([url, 200]);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.text).toContain('field /');
        expect(res.text).not.toContain('office');
      }
    });

    it('answers the app shell at "/" to the service worker too (it precaches without asking for HTML)', async () => {
      const res = await get(FIELD, '/', '*/*');
      expect(res.status).toBe(200);
      expect(res.text).toContain('field /');
      // Other pages still need a browser: a JSON caller goes to the API.
      expect((await get(FIELD, '/visits', 'application/json')).status).toBe(404);
    });

    it('installs with scope / (manifest and service worker of the root build)', async () => {
      const manifest = await get(FIELD, '/manifest.webmanifest', '*/*');
      expect(manifest.status).toBe(200);
      expect(manifest.headers['content-type']).toMatch(/application\/manifest\+json/);
      expect(manifest.text).toContain('"start_url":"/"');
      const sw = await get(FIELD, '/sw.js', '*/*');
      expect(sw.headers['service-worker-allowed']).toBe('/');
      expect(sw.headers['cache-control']).toBe('no-cache');
      expect((await get(FIELD, '/_expo/static/js/web/entry-abc123.js', '*/*')).headers['cache-control']).toContain('immutable');
      expect((await get(FIELD, '/icons/icon-192.png', 'image/*')).status).toBe(200);
    });

    it('passes API calls through to the same service (same origin, no CORS)', async () => {
      expect((await get(FIELD, '/field-work/home', 'application/json')).body).toEqual({ api: 'field home' });
      expect((await get(FIELD, '/ceo/pricing/history', 'application/json')).body).toEqual({ api: 'ceo pricing' });
      const login = await request(app.getHttpServer()).post('/auth/login').set('Host', FIELD).send({});
      expect(login.body).toEqual({ api: 'login' });
    });

    it('sends old /field links to the same page at the root', async () => {
      const res = await get(FIELD, '/field/visits?x=1');
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe('/visits?x=1');
      expect((await get(FIELD, '/field')).headers.location).toBe('/');
    });

    it('is detected from FIELD_HOST, not hard-coded', async () => {
      process.env.FIELD_HOST = 'phones.example.test, field.laboura.com';
      try {
        expect((await get('phones.example.test', '/visits')).text).toContain('field /');
        expect((await get('Field.Laboura.com:443', '/visits')).text).toContain('field /');
      } finally {
        process.env.FIELD_HOST = FIELD;
      }
      delete process.env.FIELD_HOST;
      try {
        expect((await get(FIELD, '/ceo')).text).toContain('office');
      } finally {
        process.env.FIELD_HOST = FIELD;
      }
    });
  });

  describe('host helpers', () => {
    it('normalises host names and reads FIELD_HOST', () => {
      expect(normaliseHost('https://Field.Laboura.com:443/')).toBe('field.laboura.com');
      expect(fieldHosts({ FIELD_HOST: 'field.laboura.com, https://other.test' })).toEqual(['field.laboura.com', 'other.test']);
      expect(fieldHosts({})).toEqual([]);
      expect(isFieldHost({ hostname: 'field.laboura.com', headers: {} }, { FIELD_HOST: 'field.laboura.com' })).toBe(true);
      expect(isFieldHost({ hostname: 'app.laboura.com', headers: {} }, { FIELD_HOST: 'field.laboura.com' })).toBe(false);
      expect(isFieldHost({ hostname: 'field.laboura.com', headers: {} }, {})).toBe(false);
    });
  });
});
