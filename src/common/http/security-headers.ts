import type { NextFunction, Request, Response } from 'express';

/**
 * L5 (part): basic security headers on every answer — the API, the web app
 * at /app and Laboura Field at /field.
 *   - Strict-Transport-Security (production only): browsers keep to https.
 *   - X-Content-Type-Options: nosniff — a file is never run as another type.
 *   - Referrer-Policy: no full address (which may carry a link token) is sent
 *     to another site.
 *   - X-Frame-Options: SAMEORIGIN — no other site can frame the staff screens.
 *   - no X-Powered-By (INF-12): the framework is not announced.
 * The Content-Security-Policy of the web app and Laboura Field pages is set
 * where those pages are served (content-security-policy.ts, SiteRoutingMiddleware).
 */
export function securityHeaders(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  return (_req: Request, res: Response, next: NextFunction) => {
    res.removeHeader?.('X-Powered-By');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!res.getHeader('Referrer-Policy')) res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!res.getHeader('X-Frame-Options')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  };
}
