import { isIP } from 'node:net';
import { resolveTrustProxyHops, TRUST_PROXY_ENV } from './trust-proxy';

/**
 * Whether an address belongs to a private network, a loopback, a link-local
 * range or carrier-grade NAT (what a proxy in front of the app has), or is a
 * public address (what a visitor has). Unknown text counts as private.
 */
export function isPrivateOrProxyAddress(raw: string | undefined | null): boolean {
  let ip = (raw ?? '').trim().toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (kind === 6) {
    return ip === '::1' || ip === '::' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  }
  return true;
}

export interface ProxyCheck {
  /** How many addresses the X-Forwarded-For header carried on this request. */
  forwardedForEntries: number;
  /** The TRUST_PROXY_HOPS the server runs with (0 when unset). */
  trustProxyHops: number;
  /** What the server took as the visitor's address: 'public' is right; 'private_or_proxy' means it took a proxy's. */
  clientAddress: 'public' | 'private_or_proxy';
}

/**
 * Never returns an address: only counts, the setting and a yes/no about the
 * address. `appSetting` is Express's own 'trust proxy' value (what the server
 * really runs with); without one, TRUST_PROXY_HOPS from the environment.
 */
export function proxyCheckFor(
  forwardedFor: string | string[] | undefined,
  resolvedIp: string | undefined,
  appSetting: unknown,
  env: NodeJS.ProcessEnv = process.env,
): ProxyCheck {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? '');
  let hops = 0;
  if (typeof appSetting === 'number' && Number.isInteger(appSetting)) {
    hops = appSetting;
  } else {
    try {
      hops = resolveTrustProxyHops(env[TRUST_PROXY_ENV]);
    } catch {
      hops = 0;
    }
  }
  return {
    forwardedForEntries: header.split(',').map((part) => part.trim()).filter(Boolean).length,
    trustProxyHops: hops,
    clientAddress: isPrivateOrProxyAddress(resolvedIp) ? 'private_or_proxy' : 'public',
  };
}
