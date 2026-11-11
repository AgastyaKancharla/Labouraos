const fs = require('fs');
const os = require('os');
const path = require('path');
const { basePath, buildManifest, injectHead, run } = require('./pwa');

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
    expect(sw).toContain("if (!isAppRequest(request)) return;");
    expect(JSON.parse(fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8')).name).toBe('Laboura Field');
    // Same files → same version; a changed bundle → a new version (phones update).
    expect(run(dist, '/field/').version).toBe(first.version);
    fs.writeFileSync(path.join(dist, '_expo', 'static', 'js', 'web', 'entry-1.js'), 'y');
    expect(run(dist, '/field/').version).not.toBe(first.version);
    fs.rmSync(dist, { recursive: true, force: true });
  });
});
