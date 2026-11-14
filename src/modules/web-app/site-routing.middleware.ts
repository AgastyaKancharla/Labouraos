import { Injectable, Logger, NestMiddleware, Optional } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CloudflareAccessVerifier } from '../../common/auth/cloudflare-access.verifier';
import { wantsHtml } from '../../common/public-pages';
import { resolveFieldAppFile, resolveFieldDistDir, resolveFieldRootDistDir, type FieldAppFile } from '../field-app/field-app.files';
import { fieldAppAddress, isFieldHost } from './site-hosts';
import { resolveWebAppFile, resolveWebDistDir, type WebAppFile } from './web-app.files';

/**
 * The first part of every address the office web app (web/) answers at the
 * site root. Keep in step with the routes in web/src/App.tsx and the portal
 * roots in web/src/portals/index.ts (web/src/portals/roots.test.ts checks the
 * web side).
 */
export const WEB_APP_ROOTS = ['login', 'ceo', 'manager', 'team-lead', 'finance', 'call-agent', 'p', 'field-app'] as const;

/** Of those, the ones anyone may open (public job seeker pages, invites): no Cloudflare Access. */
const PUBLIC_WEB_ROOTS = new Set<string>(['p']);

const CF_DENIED = 'Cloudflare Access identity verification required';

/**
 * The old one-page console addresses, retired once the web app and Laboura
 * Field replaced them (14 Nov). A browser that opens one (a bookmark, an old
 * message) is sent on permanently; API callers (JSON) are never redirected.
 * The old Admin Dashboard itself stays at /console/admin for the few things
 * the new screens do not do yet (AGENTS.md, "Retired consoles").
 */
export function retiredConsoleRedirect(pathname: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  switch (path) {
    case '/admin':
    case '/map':
    case '/console/map':
      return '/login';
    case '/console/call-agent':
      return '/call-agent';
    case '/field-agent':
    case '/console/field-agent':
      return fieldAppAddress(env);
    default:
      return null;
  }
}

// Laboura Field's address lives in site-hosts.ts (the sign-in uses it too); re-exported here.
export { fieldAppAddress } from './site-hosts';

type Outcome =
  | { kind: 'redirect'; status: 301; location: string }
  | { kind: 'web'; file: Exclude<WebAppFile, { kind: 'missing' }>; staff: boolean }
  | { kind: 'field'; file: Exclude<FieldAppFile, { kind: 'missing' }>; scope: '/' | '/field/' }
  | { kind: 'not-built'; app: 'web' | 'field' }
  | { kind: 'missing' }
  | { kind: 'next' };

/** The path and query of the address as the browser sent it (still percent-encoded). */
function splitUrl(originalUrl: string): { pathname: string; search: string } {
  const at = originalUrl.indexOf('?');
  return at === -1 ? { pathname: originalUrl, search: '' } : { pathname: originalUrl.slice(0, at), search: originalUrl.slice(at) };
}

/**
 * "/app/ceo" → "/ceo"; never "//evil.example" or "/\\evil.example" (browsers
 * read both as another site). Leading slashes, backslashes and their
 * percent-encoded forms are all dropped.
 */
function stripPrefix(pathname: string, prefix: string): string {
  return `/${pathname.slice(prefix.length).replace(/^(?:[/\\]|%2f|%5c)+/i, '')}`;
}

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The first path segment ('' for "/"). */
function firstSegment(pathname: string): string {
  return pathname.replace(/^\/+/, '').split('/')[0] ?? '';
}

/**
 * Decides what a GET or HEAD request gets, before the API routes see it.
 *
 * On a Laboura Field host (FIELD_HOST): the field app's own files, its
 * index.html at "/" and for every page a browser opens; everything else (API
 * calls, which ask for JSON) goes on to the API on the same address. Old /field/... links
 * there go to the same page at the root, and the old /field-agent page to the root.
 *
 * On every other host (app.laboura.com, the Render test address):
 *   - /app and /app/... → permanent redirect to the same page without /app, so
 *     links already sent by SMS or WhatsApp (invites, resets, /app/p/...) work;
 *   - the retired console addresses (/admin, /map, /field-agent, /console/...)
 *     → permanent redirect for a browser (retiredConsoleRedirect);
 *   - /field/... → Laboura Field (the /field build);
 *   - /assets/..., /favicon.png … → the office app's files;
 *   - "/" and the office app's pages (WEB_APP_ROOTS) → its index.html, but only
 *     when a browser opens them (Accept: text/html). The API shares some first
 *     segments (/ceo/..., /finance/..., /manager/...); its callers always ask
 *     for JSON, so they still reach it.
 * Anything else goes on to the API unchanged.
 */
export function routeSiteRequest(req: Pick<Request, 'method' | 'originalUrl' | 'url' | 'hostname' | 'headers'>, env: NodeJS.ProcessEnv = process.env): Outcome {
  if (req.method !== 'GET' && req.method !== 'HEAD') return { kind: 'next' };
  const { pathname, search } = splitUrl(req.originalUrl || req.url || '/');
  const browser = wantsHtml(typeof req.headers.accept === 'string' ? req.headers.accept : undefined);

  if (isFieldHost(req, env)) {
    if (under(pathname, '/field')) return { kind: 'redirect', status: 301, location: `${stripPrefix(pathname, '/field')}${search}` };
    // The old field agent page: Laboura Field is already here, at the root.
    if (browser && /^\/(?:console\/)?field-agent\/*$/.test(pathname)) return { kind: 'redirect', status: 301, location: '/' };
    const dist = resolveFieldRootDistDir();
    const file = dist ? resolveFieldAppFile(dist, pathname, '') : null;
    if (file?.kind === 'file') return { kind: 'field', file, scope: '/' };
    // The app shell itself ("/") is always the app: the service worker
    // precaches it without asking for HTML. No API route lives at "/".
    const shell = pathname === '/' || pathname === '/index.html';
    if (!browser && !shell) return { kind: 'next' };
    if (!dist) return { kind: 'not-built', app: 'field' };
    if (file?.kind === 'index') return { kind: 'field', file, scope: '/' };
    return { kind: 'next' };
  }

  if (under(pathname, '/app')) return { kind: 'redirect', status: 301, location: `${stripPrefix(pathname, '/app')}${search}` };

  const retired = browser ? retiredConsoleRedirect(pathname, env) : null;
  if (retired) return { kind: 'redirect', status: 301, location: retired };

  if (under(pathname, '/field')) {
    const dist = resolveFieldDistDir();
    if (!dist) return { kind: 'not-built', app: 'field' };
    const file = resolveFieldAppFile(dist, pathname, '/field');
    return file.kind === 'missing' ? { kind: 'missing' } : { kind: 'field', file, scope: '/field/' };
  }

  const segment = firstSegment(pathname);
  const isStaticFile = under(pathname, '/assets') || (pathname.lastIndexOf('/') === 0 && /\.[a-z0-9]+$/i.test(pathname));
  if (isStaticFile) {
    const dist = resolveWebDistDir();
    if (!dist) return under(pathname, '/assets') ? { kind: 'not-built', app: 'web' } : { kind: 'next' };
    const file = resolveWebAppFile(dist, pathname);
    if (file.kind === 'file') return { kind: 'web', file, staff: false };
    return under(pathname, '/assets') ? { kind: 'missing' } : { kind: 'next' };
  }

  const isWebPage = pathname === '/' || (WEB_APP_ROOTS as readonly string[]).includes(segment);
  if (!isWebPage || !browser) return { kind: 'next' };
  const dist = resolveWebDistDir();
  if (!dist) return { kind: 'not-built', app: 'web' };
  const file = resolveWebAppFile(dist, pathname);
  if (file.kind === 'missing') return { kind: 'missing' };
  return { kind: 'web', file, staff: !PUBLIC_WEB_ROOTS.has(segment) };
}

/**
 * Serves the office web app and Laboura Field by host and path (see
 * routeSiteRequest). Registered for every path in WebAppModule, so it runs
 * before the API routes. The files hold no data: every data call needs a staff
 * login (JWT) and passes RBAC. The staff portals' pages stay behind Cloudflare
 * Access when CLOUDFLARE_ACCESS_ENFORCED is true, like the old consoles.
 */
@Injectable()
export class SiteRoutingMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SiteRoutingMiddleware.name);

  constructor(@Optional() private readonly cloudflare?: CloudflareAccessVerifier) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const outcome = routeSiteRequest(req);
    switch (outcome.kind) {
      case 'next':
        return next();
      case 'redirect':
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.redirect(outcome.status, outcome.location);
      case 'missing':
        res.status(404).json({ statusCode: 404, message: 'File not found' });
        return;
      case 'not-built':
        res.status(503).json({
          statusCode: 503,
          message: outcome.app === 'web'
            ? 'The web app has not been built yet (npm run web:build).'
            : 'Laboura Field has not been built yet (npm run field:build-web).',
        });
        return;
      case 'web':
        if (outcome.staff && !(await this.cloudflareAllows(req))) {
          res.status(403).json({ statusCode: 403, message: CF_DENIED });
          return;
        }
        return this.sendWeb(res, outcome.file);
      case 'field':
        return this.sendField(res, outcome.file, outcome.scope);
    }
  }

  private async cloudflareAllows(req: Request): Promise<boolean> {
    if (process.env.CLOUDFLARE_ACCESS_ENFORCED !== 'true') return true;
    const assertion = req.headers['cf-access-jwt-assertion'];
    if (typeof assertion !== 'string' || !assertion || !this.cloudflare) return false;
    try {
      await this.cloudflare.verify(assertion);
      return true;
    } catch (err) {
      this.logger.warn(`Cloudflare Access assertion rejected: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private sendWeb(res: Response, file: Exclude<WebAppFile, { kind: 'missing' }>): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (file.kind === 'index') {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Frame-Options', 'DENY');
      res.sendFile(file.absolutePath, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return;
    }
    res.setHeader('Cache-Control', file.immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    res.sendFile(file.absolutePath);
  }

  private sendField(res: Response, file: Exclude<FieldAppFile, { kind: 'missing' }>, scope: '/' | '/field/'): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (file.kind === 'index') {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Frame-Options', 'DENY');
      res.sendFile(file.absolutePath, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return;
    }
    if (file.serviceWorker) res.setHeader('Service-Worker-Allowed', scope);
    res.setHeader(
      'Cache-Control',
      file.cache === 'immutable' ? 'public, max-age=31536000, immutable' : file.cache === 'fresh' ? 'no-cache' : 'public, max-age=3600',
    );
    const headers: Record<string, string> = {};
    if (file.absolutePath.endsWith('.webmanifest')) headers['Content-Type'] = 'application/manifest+json';
    res.sendFile(file.absolutePath, { headers });
  }
}
