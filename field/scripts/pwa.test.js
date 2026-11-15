const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { basePath, buildManifest, injectHead, normaliseBase, run } = require('./pwa');

const exported = `<!doctype html><html lang="en"><head>
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
<meta name="theme-color" content="#0055C0"></head><body><div id="root"></div></body></html>`;

describe('installable web app (scripts/pwa.js)', () => {
  it('reads /field from app.json', () => {
    expect(basePath()).toBe('/field/');
  });

  it('builds a standalone "Laboura Field" manifest scoped to /field', () => {
    const m = buildManifest('/field/');
    expect(m).toMatchObject({ name: 'Laboura Field', short_name: 'Laboura Field', display: 'standalone', start_url: '/field/', scope: '/field/', theme_color: '#0055C0' });
    expect(m.icons.map((i) => i.purpose)).toEqual(['any', 'any', 'maskable']);
    expect(m.icons.every((i) => i.src.startsWith('/field/icons/'))).toBe(true);
  });

  it('adds the iPhone "Add to Home Screen" tags once', () => {
    const html = injectHead(exported, '/field/');
    expect(html).toContain('<link rel="manifest" href="/field/manifest.webmanifest"');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Laboura Field">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/field/icons/apple-touch-icon.png">');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('<script src="/field/register-sw.js" defer></script>');
    expect(html.match(/theme-color/g)).toHaveLength(1);
    expect(injectHead(html, '/field/')).toBe(html);
  });

  it('writes the manifest and a service worker that precaches the whole app but no API calls', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'field-pwa-'));
    fs.mkdirSync(path.join(dist, '_expo', 'static', 'js', 'web'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), exported);
    fs.writeFileSync(path.join(dist, '_expo', 'static', 'js', 'web', 'entry-1.js'), 'x');
    fs.writeFileSync(path.join(dist, 'metadata.json'), '{}');
    const first = run(dist, '/field/');
    const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
    expect(sw).toContain('"/field/_expo/static/js/web/entry-1.js"');
    expect(sw).toContain('"/field/"');
    expect(sw).toContain('"/field/manifest.webmanifest"');
    expect(sw).not.toContain('metadata.json');
    // "Scan Aadhaar QR": the QR decoder's WebAssembly is served from the app itself, never a CDN.
    expect(fs.statSync(path.join(dist, 'zxing_reader.wasm')).size).toBeGreaterThan(100000);
    expect(sw).toContain('"/field/zxing_reader.wasm"');
    expect(sw).toContain("if (!isAppRequest(request)) return;");
    expect(JSON.parse(fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8')).name).toBe('Laboura Field');
    // Same files → same version; a changed bundle → a new version (phones update).
    expect(run(dist, '/field/').version).toBe(first.version);
    fs.writeFileSync(path.join(dist, '_expo', 'static', 'js', 'web', 'entry-1.js'), 'y');
    expect(run(dist, '/field/').version).not.toBe(first.version);
    fs.rmSync(dist, { recursive: true, force: true });
  });

  describe('the second build, for the root of field.laboura.com (decided 14 Nov)', () => {
    function build(base) {
      const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'field-pwa-'));
      fs.mkdirSync(path.join(dist, '_expo', 'static', 'js', 'web'), { recursive: true });
      fs.mkdirSync(path.join(dist, 'icons'));
      fs.writeFileSync(path.join(dist, 'index.html'), exported);
      fs.writeFileSync(path.join(dist, '_expo', 'static', 'js', 'web', 'entry-1.js'), 'x');
      fs.writeFileSync(path.join(dist, 'icons', 'icon-192.png'), 'png');
      run(dist, base);
      return dist;
    }

    /** Loads the generated sw.js and returns its isAppRequest, as a phone would run it on `origin`. */
    function serviceWorker(dist, origin) {
      const context = { self: { location: new URL(origin), addEventListener: () => {} }, caches: {}, URL, Set, Promise, setTimeout, fetch: () => {} };
      vm.runInNewContext(fs.readFileSync(path.join(dist, 'sw.js'), 'utf8'), context);
      return (url, mode = 'cors') => context.isAppRequest({ method: 'GET', url: new URL(url, origin).toString(), mode });
    }

    it('normalises the base path', () => {
      expect(normaliseBase('/field')).toBe('/field/');
      expect(normaliseBase('/')).toBe('/');
      expect(normaliseBase('')).toBe('/');
    });

    it('installs at / with scope /', () => {
      const dist = build('/');
      const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8'));
      expect(manifest).toMatchObject({ start_url: '/', scope: '/', id: '/', display: 'standalone' });
      expect(manifest.icons[0].src).toBe('/icons/icon-192.png');
      expect(fs.readFileSync(path.join(dist, 'register-sw.js'), 'utf8')).toContain('register("/sw.js", { scope: "/" })');
      const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
      expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
      expect(html).toContain('<script src="/register-sw.js" defer></script>');
      fs.rmSync(dist, { recursive: true, force: true });
    });

    it('caches its own files and pages for weak signal, but never an API call on the same address', () => {
      const dist = build('/');
      const isApp = serviceWorker(dist, 'https://field.laboura.com');
      expect(isApp('/', 'navigate')).toBe(true);
      expect(isApp('/visits', 'navigate')).toBe(true);
      expect(isApp('/_expo/static/js/web/entry-1.js')).toBe(true);
      expect(isApp('/icons/icon-192.png')).toBe(true);
      expect(isApp('/manifest.webmanifest')).toBe(true);
      expect(isApp('/field-work/home')).toBe(false);
      expect(isApp('/attendance/today')).toBe(false);
      expect(isApp('/auth/field/refresh')).toBe(false);
      expect(isApp('https://other.example/_expo/x.js')).toBe(false);
      fs.rmSync(dist, { recursive: true, force: true });
    });

    it('keeps the /field build to /field', () => {
      const dist = build('/field/');
      const isApp = serviceWorker(dist, 'https://laboura-api.onrender.com');
      expect(isApp('/field/visits', 'navigate')).toBe(true);
      expect(isApp('/field/_expo/static/js/web/entry-1.js')).toBe(true);
      expect(isApp('/ceo', 'navigate')).toBe(false);
      expect(isApp('/field-work/home')).toBe(false);
      fs.rmSync(dist, { recursive: true, force: true });
    });
  });

  it('makes the root build from LABOURA_FIELD_BASE_URL=/ (app.config.js)', () => {
    const appConfig = require('../app.config.js');
    const config = { name: 'Laboura Field', experiments: { baseUrl: '/field' } };
    const previous = process.env.LABOURA_FIELD_BASE_URL;
    try {
      delete process.env.LABOURA_FIELD_BASE_URL;
      expect(appConfig({ config }).experiments.baseUrl).toBe('/field');
      process.env.LABOURA_FIELD_BASE_URL = '/';
      expect(appConfig({ config }).experiments).not.toHaveProperty('baseUrl');
      expect(config.experiments.baseUrl).toBe('/field');
    } finally {
      if (previous === undefined) delete process.env.LABOURA_FIELD_BASE_URL;
      else process.env.LABOURA_FIELD_BASE_URL = previous;
    }
  });
});
