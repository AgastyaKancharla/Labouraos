import { INestApplication, Logger } from '@nestjs/common';

export const TRUST_PROXY_ENV = 'TRUST_PROXY_HOPS';
const MAX_HOPS = 5;

/**
 * Number of reverse proxies sitting in front of the app whose X-Forwarded-For
 * entries may be believed. Anything a client sends to the outermost proxy lands
 * to the left of the entries our own proxies add, so with N trusted hops Express
 * resolves `req.ip` to the address the Nth proxy saw and ignores everything to
 * its left. 0 (the default) means "no proxy": the header is ignored entirely.
 */
export function resolveTrustProxyHops(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return 0;
  }
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0 || hops > MAX_HOPS) {
    throw new Error(
      `${TRUST_PROXY_ENV} must be an integer between 0 and ${MAX_HOPS}; got "${raw}"`,
    );
  }
  return hops;
}

export function applyTrustProxy(
  app: INestApplication,
  raw: string | undefined = process.env[TRUST_PROXY_ENV],
): number {
  const hops = resolveTrustProxyHops(raw);
  // `set` is on the underlying Express instance; Nest's adapter type hides it.
  (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set(
    'trust proxy',
    hops,
  );
  if (hops === 0 && process.env.NODE_ENV === 'production') {
    new Logger('TrustProxy').warn(
      `${TRUST_PROXY_ENV} is unset/0 in production: client IPs resolve to the proxy's address, so rate limits share one bucket per account. Set it to the number of proxies in front of the app.`,
    );
  }
  return hops;
}
