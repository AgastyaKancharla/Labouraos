import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';

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
    // No plugins. A bill opened as a PDF in a new tab (a blob: document that keeps
    // this policy) still shows in the browser's PDF viewer: checked in Chromium (L3).
    ['object-src', ["'none'"]],
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

/**
 * L3: every other HTML answer of the API (receipts, invoices, the candidate
 * introduction card, legal acceptance texts, customer documents, the referral
 * terms fallback page, the CEO status page…) gets a locked-down policy unless
 * its route set its own: nothing runs, nothing is fetched, only inline styles
 * and images from the app, data: and Supabase Storage (signed photo links).
 */
export function defaultHtmlPolicy(env: NodeJS.ProcessEnv = process.env): string {
  const storage = storageOrigin(env);
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src 'self' data:${storage ? ` ${storage}` : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The invoice page's print button handler, allowed by its hash ('unsafe-hashes' allows only exactly this text). */
export const PRINT_BUTTON_HANDLER = 'window.print()';
export const PRINT_BUTTON_HASH = `'sha256-${createHash('sha256').update(PRINT_BUTTON_HANDLER).digest('base64')}'`;

/** The invoice page: the default HTML policy plus its one print button handler. */
export function invoicePagePolicy(env: NodeJS.ProcessEnv = process.env): string {
  return `${defaultHtmlPolicy(env)}; script-src 'unsafe-hashes' ${PRINT_BUTTON_HASH}`;
}

/**
 * Sets defaultHtmlPolicy on an HTML answer that carries no policy of its own,
 * just before the headers go out (the content type is only known then).
 */
const ownPolicy = new WeakSet<object>();

/** This answer decides its own policy (the app shells, also with CONTENT_SECURITY_POLICY=off). */
export function markOwnHtmlPolicy(res: object): void {
  ownPolicy.add(res);
}

export function installDefaultHtmlPolicy(res: ServerResponse, env: NodeJS.ProcessEnv = process.env): void {
  const original = res.writeHead as unknown as (...args: unknown[]) => unknown;
  (res as unknown as { writeHead: (...args: unknown[]) => unknown }).writeHead = function writeHead(this: unknown, ...args: unknown[]) {
    const type = String(res.getHeader('Content-Type') ?? '');
    const headerArg = args.find((a) => a && typeof a === 'object' && !Array.isArray(a)) as Record<string, unknown> | undefined;
    const argType = headerArg ? String(Object.entries(headerArg).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '') : '';
    const hasPolicy = res.getHeader('Content-Security-Policy') || res.getHeader('Content-Security-Policy-Report-Only');
    if (!hasPolicy && !ownPolicy.has(res) && /text\/html/i.test(`${type} ${argType}`)) res.setHeader('Content-Security-Policy', defaultHtmlPolicy(env));
    return original.apply(this, args);
  };
}
