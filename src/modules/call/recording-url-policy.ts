import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';

/**
 * IN-4: the call-status webhook names a recording address that the server then
 * downloads. Even with the webhook signed, the server must never be made to
 * fetch an internal address (Render's private network, the cloud metadata
 * service at 169.254.169.254, localhost). Before any fetch:
 *   - https only, port 443, no user:password in the address;
 *   - the host must be on RECORDING_URL_HOSTS (comma-separated; `*.example.com`
 *     allows every sub-domain). Unset or empty: no recording is ever fetched;
 *   - the host may not be a private, loopback, link-local or other internal IP,
 *     and every address its name resolves to is checked again at connect time
 *     (the check runs inside the connection's DNS lookup, so a name that
 *     changes its answer between the check and the fetch is still refused);
 *   - redirects are followed at most 3 times, each new address checked the same way.
 */
export const RECORDING_URL_HOSTS_ENV = 'RECORDING_URL_HOSTS';

export class RecordingUrlRefusedError extends Error {
  constructor(reason: string) {
    super(`Recording address refused: ${reason}`);
    this.name = 'RecordingUrlRefusedError';
  }
}

/** The allowed provider hosts, lower case. */
export function recordingHostAllowList(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env[RECORDING_URL_HOSTS_ENV] ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
}

export function hostAllowed(host: string, allowList: readonly string[]): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return allowList.some((entry) => {
    if (entry.startsWith('*.')) {
      const base = entry.slice(2);
      return name.endsWith(`.${base}`) && name.length > base.length + 1;
    }
    return name === entry;
  });
}

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255) ? parts : null;
}

/** False for every address that is not on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b, c] = ipv4Parts(ip)!;
    if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, TEST-NET-1
    if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
    if (a >= 224) return false; // multicast, reserved, broadcast
    return true;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return false;
    // IPv4-mapped / -compatible (::ffff:10.0.0.1, ::ffff:a00:1): judge the IPv4 address.
    const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]);
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
    if ((first & 0xffc0) === 0xfec0) return false; // site-local (deprecated)
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (lower.startsWith('64:ff9b:')) return false; // NAT64 can reach internal IPv4
    if (lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return false; // documentation
    if (lower.startsWith('2002:')) return false; // 6to4 wraps an IPv4 address
    return true;
  }
  return false;
}

/** Checks the address itself (no DNS). Throws RecordingUrlRefusedError. */
export function checkRecordingUrl(raw: string, allowList: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RecordingUrlRefusedError('not a valid address');
  }
  if (url.protocol !== 'https:') throw new RecordingUrlRefusedError('only https is allowed');
  if (url.username || url.password) throw new RecordingUrlRefusedError('an address with a user name or password is not allowed');
  if (url.port && url.port !== '443') throw new RecordingUrlRefusedError('only the standard https port is allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) throw new RecordingUrlRefusedError('a private, loopback or link-local address is not allowed');
  if (!allowList.length) throw new RecordingUrlRefusedError(`${RECORDING_URL_HOSTS_ENV} is not set, so no recording host is allowed`);
  if (!hostAllowed(host, allowList)) throw new RecordingUrlRefusedError(`the host ${host} is not on ${RECORDING_URL_HOSTS_ENV}`);
  return url;
}

type LookupAddress = { address: string; family: number };
type LookupAll = (hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const systemLookupAll: LookupAll = (hostname, callback) => dnsLookup(hostname, { all: true, verbatim: true }, callback);

/**
 * A `lookup` for https.request: resolves the name and refuses the connection
 * if ANY address it resolves to is not public (the check happens at connect
 * time, so DNS rebinding cannot slip an internal address in after the check).
 */
export function publicOnlyLookup(resolveAll: LookupAll = systemLookupAll) {
  return (
    hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    resolveAll(hostname, (err, addresses) => {
      if (err) return callback(err, '', 0);
      if (!addresses.length) return callback(Object.assign(new Error(`No address for ${hostname}`), { code: 'ENOTFOUND' }), '', 0);
      const internal = addresses.find((a) => !isPublicAddress(a.address));
      if (internal) {
        return callback(Object.assign(new RecordingUrlRefusedError(`${hostname} resolves to a private, loopback or link-local address`), { code: 'EREFUSED_INTERNAL' }), '', 0);
      }
      if (typeof options === 'object' && options?.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
