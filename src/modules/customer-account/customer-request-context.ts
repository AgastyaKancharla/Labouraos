import { Request } from 'express';
import { RequestContext } from './customer-sign-in.service';

/** The header the app sends on every request: its install id (docs/customer-app-api.md 1.3). */
export const INSTALLATION_HEADER = 'x-laboura-installation';

export function requestContext(req: Request): RequestContext {
  const installation = req.headers?.[INSTALLATION_HEADER];
  const userAgent = req.headers?.['user-agent'];
  return {
    ip: req.ip || req.socket?.remoteAddress || null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    installationId: typeof installation === 'string' && installation.trim() ? installation.trim().slice(0, 100) : null,
  };
}
