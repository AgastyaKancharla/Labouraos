import type { NextFunction, Request, Response } from 'express';

/**
 * L5 (part): basic security headers on every answer — the API, the web app
 * at /app and Laboura Field at /field.
 *   - Strict-Transport-Security (production only): browsers keep to https.
 *   - X-Content-Type-Options: nosniff — a file is never run as another type.
 *   - Referrer-Policy: no full address (which may carry a link token) is sent
 *     to another site.
 *   - X-Frame-Options: SAMEORIGIN — no other site can frame the staff screens.
 * A content-security-policy for /app and /field is not set here: it needs
 * checking against every screen first.
 */
export function securityHeaders(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === 'production';
  return (_req: Request, res: Response, next: NextFunction) => {
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!res.getHeader('Referrer-Policy')) res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!res.getHeader('X-Frame-Options')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  };
}
