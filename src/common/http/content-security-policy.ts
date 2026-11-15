/**
 * IN-6 / INF-12: a Content-Security-Policy on the pages of the office web app
 * (the site root of app.laboura.com, including the public /p/ pages) and of
 * Laboura Field (/field and field.laboura.com). Staff tokens live in the
 * browser's storage, so the policy's main job is that no script can run unless
 * it is one of the app's own files: no inline script, no eval, no script from
 * another site.
 *
 * What each screen needs (checked screen by screen in the code, and in a
 * headless browser against a local API with the policy enforced):
 *   - scripts: the app's own files; WebAssembly for the QR readers (zxing in
 *     the web app's Aadhaar scanner and Laboura Field's camera) needs
 *     'wasm-unsafe-eval' (it allows compiling WebAssembly, not JavaScript eval);
 *   - styles: the app's own CSS, inline styles (React Native Web and the print
 *     windows write <style> elements) and Google Fonts' stylesheet (web app);
 *   - fonts: the app's own files and Google Fonts (fonts.gstatic.com);
 *   - images: the app's own, data: and blob: (camera previews, QR codes),
 *     signed photo links from Supabase Storage (SUPABASE_URL) and the map tiles
 *     of Laboura Field (tile.openstreetmap.org);
 *   - audio: signed recording links from Supabase Storage, blob: camera streams;
 *   - API calls: the same address (the app is served by the API), plus
 *     Supabase Storage for signed links;
 *   - workers: the app's own (pdf.js reads an e-Aadhaar PDF; Laboura Field's
 *     service worker) and blob:;
 *   - no framing by any other site, no <base> or form posts elsewhere.
 * wa.me and tel: links are navigations, which a CSP does not restrict.
 *
 * CONTENT_SECURITY_POLICY: `enforce` (default) or `report-only` (browsers only
 * report a breach in the console and nothing is blocked: the first thing to
 * try if a screen ever breaks after a change) or `off`.
 */
export const CONTENT_SECURITY_POLICY_SETTING = 'CONTENT_SECURITY_POLICY';

export type CspApp = 'web' | 'field';

const OSM_TILES = 'https://tile.openstreetmap.org';
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';

/** The https origin of SUPABASE_URL (signed storage links), or null. */
function storageOrigin(env: NodeJS.ProcessEnv): string | null {
  const raw = env.SUPABASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(app: CspApp, env: NodeJS.ProcessEnv = process.env): string {
  const storage = storageOrigin(env);
  const extra = (list: Array<string | null | false>) => list.filter((v): v is string => Boolean(v));
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", "'wasm-unsafe-eval'"]],
    ['style-src', extra(["'self'", "'unsafe-inline'", app === 'web' && GOOGLE_FONTS_CSS])],
    ['font-src', extra(["'self'", 'data:', app === 'web' && GOOGLE_FONTS_FILES])],
    ['img-src', extra(["'self'", 'data:', 'blob:', storage, app === 'field' && OSM_TILES])],
    ['media-src', extra(["'self'", 'blob:', storage])],
    ['connect-src', extra(["'self'", storage])],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    // A bill opened as a PDF in a new tab is a blob: document that keeps this policy.
    ['object-src', ["'self'", 'blob:']],
    ['frame-src', ["'self'", 'blob:']],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(' ')}`);
  if (env.NODE_ENV === 'production' && cspMode(env) === 'enforce') parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

function cspMode(env: NodeJS.ProcessEnv): 'enforce' | 'report-only' | 'off' {
  const mode = (env[CONTENT_SECURITY_POLICY_SETTING] ?? '').trim().toLowerCase();
  return mode === 'off' || mode === 'report-only' ? mode : 'enforce';
}

/** The header to send ([name, value]), or null when switched off. */
export function contentSecurityPolicyHeader(app: CspApp, env: NodeJS.ProcessEnv = process.env): [string, string] | null {
  const mode = cspMode(env);
  if (mode === 'off') return null;
  const name = mode === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  return [name, contentSecurityPolicy(app, env)];
}
