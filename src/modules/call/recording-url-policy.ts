import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';

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

/** IPv4 ranges that are not the public internet. */
const PRIVATE_V4 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) PRIVATE_V4.addSubnet(net, prefix, 'ipv4');

/** IPv6 global unicast (2000::/3) is the only public IPv6 space. */
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6');
/** Inside 2000::/3, ranges that are not plain public hosts (or that wrap an IPv4 address). */
const SPECIAL_V6 = new BlockList();
for (const [net, prefix] of [
  ['2001::', 32], // Teredo (wraps an IPv4 address)
  ['2001:2::', 48], // benchmarking
  ['2001:10::', 28], ['2001:20::', 28], // ORCHID
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (wraps an IPv4 address)
  ['3fff::', 20], // documentation
] as const) SPECIAL_V6.addSubnet(net, prefix, 'ipv6');

/**
 * False for every address that is not on the public internet. Checked with
 * net.BlockList, which reads every spelling of an address (L4): IPv6 forms
 * such as ::7f00:1, 0::1, ::ffff:0:7f00:1 or ::ffff:127.0.0.1 are outside
 * 2000::/3 and refused, and so is any IPv6 range that wraps an IPv4 address.
 */
export function isPublicAddress(raw: string): boolean {
  const ip = raw.trim().replace(/^\[|\]$/g, '').split('%')[0]!;
  const family = isIP(ip);
  if (family === 4) return !PRIVATE_V4.check(ip, 'ipv4');
  if (family === 6) return GLOBAL_V6.check(ip, 'ipv6') && !SPECIAL_V6.check(ip, 'ipv6');
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
